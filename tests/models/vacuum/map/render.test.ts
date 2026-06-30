import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
// NOTE: robots were asleep during e2e capture — these tests render a SYNTHETIC
// I-frame decoded from the shared frame builder, not a guaranteed live blob.
// Assertions are STRUCTURAL (PNG signature + dimensions), not pixel-exact.
import { decodeVacuumMap } from '../../../../src/models/vacuum/map/decode.js';
import { renderVacuumPng } from '../../../../src/models/vacuum/map/render.js';
import type { VacuumMap } from '../../../../src/models/vacuum/map/types.js';
import { buildSyntheticFrame } from './fixtures/build-frame.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const WALL = 63 << 2;
const FLOOR = 62 << 2;
const SEG5 = 5 << 2;

function syntheticMap() {
  // 4x2 grid: wall floor seg5 seg5 / outside outside seg5 seg5
  const grid = Buffer.from([WALL, FLOOR, SEG5, SEG5, 0, 0, SEG5, SEG5]);
  const { envelope } = buildSyntheticFrame({
    mapId: 1,
    frameId: 0,
    frameType: 'I',
    robot: { x: 0, y: 0, a: 0 },
    charger: { x: 0, y: 0, a: 0 },
    gridSize: 50,
    width: 4,
    height: 2,
    left: 0,
    top: 0,
    grid,
    tail: { timestamp_ms: 1, seg_inf: { '5': {} } },
  });
  return decodeVacuumMap(envelope);
}

describe('renderVacuumPng', () => {
  it('produces a valid PNG sized to the map dimensions', () => {
    const map = syntheticMap();
    const png = renderVacuumPng(map);
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    const decoded = PNG.sync.read(png);
    expect(decoded.width).toBe(map.dimensions.width);
    expect(decoded.height).toBe(map.dimensions.height);
  });

  it('paints opaque pixels where layers exist and transparent where empty', () => {
    const map = syntheticMap();
    // Isolate layer painting — the fixture parks robot+charger at world (0,0),
    // which the renderer now draws on top; disable the markers for this check.
    const decoded = PNG.sync.read(renderVacuumPng(map, { showRobot: false, showCharger: false }));
    // Y is flipped (see render.ts header): grid row 0 (wall at col 0) renders to
    // the BOTTOM pixel row, grid row 1 (`outside`/0) to the TOP.
    // Bottom-left pixel (0,1) is the wall → opaque (alpha 255).
    const wall = (1 * decoded.width + 0) * 4;
    expect(decoded.data[wall + 3]).toBe(255);
    // Top-left pixel (0,0) is `outside`/0 → never painted → transparent.
    const empty = (0 * decoded.width + 0) * 4;
    expect(decoded.data[empty + 3]).toBe(0);
  });

  it('respects an optional integer scale factor (nearest-neighbour)', () => {
    const map = syntheticMap();
    const decoded = PNG.sync.read(renderVacuumPng(map, { scale: 4 }));
    expect(decoded.width).toBe(map.dimensions.width * 4);
    expect(decoded.height).toBe(map.dimensions.height * 4);
  });

  it('clamps a non-positive or fractional scale to a sane integer floor of 1', () => {
    const map = syntheticMap();
    const decoded = PNG.sync.read(renderVacuumPng(map, { scale: 0 }));
    expect(decoded.width).toBe(map.dimensions.width);
    const decodedFrac = PNG.sync.read(renderVacuumPng(map, { scale: 2.9 }));
    expect(decodedFrac.width).toBe(map.dimensions.width * 2);
  });

  it('gives different segment ids different opaque colours (deterministic palette)', () => {
    // Two distinct segment ids in one row → distinct RGB.
    const grid = Buffer.from([3 << 2, 9 << 2]);
    const { envelope } = buildSyntheticFrame({
      mapId: 1,
      frameId: 0,
      frameType: 'I',
      robot: { x: 0, y: 0, a: 0 },
      charger: { x: 0, y: 0, a: 0 },
      gridSize: 50,
      width: 2,
      height: 1,
      left: 0,
      top: 0,
      grid,
      tail: { timestamp_ms: 1, seg_inf: { '3': {}, '9': {} } },
    });
    const map = decodeVacuumMap(envelope);
    // Markers off so the seg cells at (0,0)/(1,0) aren't overdrawn by the
    // fixture's robot/charger at world (0,0).
    const decoded = PNG.sync.read(renderVacuumPng(map, { showRobot: false, showCharger: false }));
    const a = [decoded.data[0], decoded.data[1], decoded.data[2]];
    const b = [decoded.data[4], decoded.data[5], decoded.data[6]];
    expect(a).not.toEqual(b);
    expect(decoded.data[3]).toBe(255);
    expect(decoded.data[7]).toBe(255);
  });
});

// ── Overlay rendering ────────────────────────────────────────────────────────
// These build a VacuumMap literal directly (the renderer's contract is
// VacuumMap → PNG) so paths / robot / zones can be placed at known pixels.

/** A 20×20 mm-grid map (gridSize 1 → 1px per mm) with everything empty. */
function baseMap(over: Partial<VacuumMap> = {}): VacuumMap {
  return {
    mapId: 1,
    frameId: 0,
    frameType: 'I',
    timestamp: 1,
    rotation: 0,
    dimensions: { left: 0, top: 0, width: 20, height: 20, gridSize: 1 },
    robot: null,
    dock: null,
    docked: false,
    layers: [],
    segments: [],
    paths: [],
    obstacles: [],
    virtualWalls: [],
    restrictedAreas: [],
    lowLyingAreas: [],
    wallsInfo: null,
    cleanedArea: null,
    ...over,
  };
}

function rgbAt(png: Buffer, x: number, y: number): [number, number, number, number] {
  const d = PNG.sync.read(png);
  const off = (y * d.width + x) * 4;
  return [d.data[off]!, d.data[off + 1]!, d.data[off + 2]!, d.data[off + 3]!];
}

describe('renderVacuumPng overlays', () => {
  it('honours the colorScheme palette for floor fills', () => {
    // Floor run at grid row 5 → pixel row (height-1-5)=14 after the Y flip.
    const map = baseMap({ layers: [{ type: 'floor', runs: [[5, 5, 1]] }] });
    const light = rgbAt(renderVacuumPng(map, { colorScheme: 'dreame-light' }), 5, 14);
    const dark = rgbAt(renderVacuumPng(map, { colorScheme: 'dreame-dark' }), 5, 14);
    expect(light).not.toEqual(dark);
    expect(light.slice(0, 3)).toEqual([210, 222, 235]);
    expect(dark.slice(0, 3)).toEqual([40, 46, 56]);
  });

  it('draws the robot marker, and omits it when showRobot is false', () => {
    const map = baseMap({ robot: { x: 10, y: 10, angle: 0 } });
    expect(rgbAt(renderVacuumPng(map), 10, 10)[3]).toBe(255);
    expect(rgbAt(renderVacuumPng(map, { showRobot: false }), 10, 10)[3]).toBe(0);
  });

  it('draws the charger marker, gated on showCharger', () => {
    // dock world y=3 → pixel row (height-1-3)=16 after the Y flip.
    const map = baseMap({ dock: { x: 3, y: 3, angle: 0 } });
    expect(rgbAt(renderVacuumPng(map), 3, 16)[3]).toBe(255);
    expect(rgbAt(renderVacuumPng(map, { showCharger: false }), 3, 16)[3]).toBe(0);
  });

  it('draws the cleaning path polyline, gated on showPath', () => {
    const map = baseMap({
      paths: [
        {
          type: 'sweep',
          points: [
            { x: 2, y: 10 },
            { x: 17, y: 10 },
          ],
        },
      ],
    });
    // Horizontal path at world y=10 → pixel row (height-1-10)=9 after the Y flip.
    expect(rgbAt(renderVacuumPng(map), 9, 9)[3]).toBeGreaterThan(0);
    expect(rgbAt(renderVacuumPng(map, { showPath: false }), 9, 9)[3]).toBe(0);
  });

  it('fills a no-go restricted area, gated on showNoGo', () => {
    const map = baseMap({
      restrictedAreas: [{ kind: 'noGo', bbox: { xMin: 4, yMin: 4, xMax: 9, yMax: 9 } }],
    });
    // y 4..9 → pixel rows 10..15 after the Y flip; (6,12) is inside the rect.
    expect(rgbAt(renderVacuumPng(map), 6, 12)[3]).toBeGreaterThan(0);
    expect(rgbAt(renderVacuumPng(map, { showNoGo: false }), 6, 12)[3]).toBe(0);
  });

  it('flips Y: a feature near world-top renders near the image BOTTOM', () => {
    // A floor cell at grid row 1 (near the top of a 20-tall map) must land near
    // the BOTTOM of the image (row 18), and NOT at the top (row 1) — the mirror
    // fix that aligns camstack with the Dreamehome app / HA.
    const map = baseMap({ layers: [{ type: 'floor', runs: [[10, 1, 1]] }] });
    expect(rgbAt(renderVacuumPng(map), 10, 18)[3]).toBe(255); // (height-1)-1 = 18
    expect(rgbAt(renderVacuumPng(map), 10, 1)[3]).toBe(0);
  });

  it('draws a virtual wall line, gated on showVirtualWalls', () => {
    const map = baseMap({
      virtualWalls: [{ from: { x: 2, y: 2 }, to: { x: 2, y: 17 } }],
    });
    expect(rgbAt(renderVacuumPng(map), 2, 9)[3]).toBeGreaterThan(0);
    expect(rgbAt(renderVacuumPng(map, { showVirtualWalls: false }), 2, 9)[3]).toBe(0);
  });

  it('only draws segment labels when showSegmentLabels is enabled', () => {
    const map = baseMap({
      segments: [
        {
          id: 3,
          name: null,
          bbox: { xMin: 0, yMin: 0, xMax: 20, yMax: 20 },
          centroid: { x: 10, y: 10 },
          neighbours: [],
          floorMaterial: null,
          floorDirection: null,
          active: true,
        },
      ],
    });
    // The digit glyph paints at least one opaque pixel around the centroid.
    const withLabel = PNG.sync.read(renderVacuumPng(map, { showSegmentLabels: true, scale: 2 }));
    let painted = 0;
    for (let y = 14; y < 26; y += 1) {
      for (let x = 14; x < 26; x += 1) {
        if ((withLabel.data[(y * withLabel.width + x) * 4 + 3] ?? 0) > 0) painted += 1;
      }
    }
    expect(painted).toBeGreaterThan(0);
    const withoutLabel = PNG.sync.read(renderVacuumPng(map, { scale: 2 }));
    let paintedOff = 0;
    for (let i = 3; i < withoutLabel.data.length; i += 4) {
      if ((withoutLabel.data[i] ?? 0) > 0) paintedOff += 1;
    }
    expect(paintedOff).toBe(0);
  });
});

describe('renderVacuumPng enrichment', () => {
  function countPainted(png: Buffer): number {
    const d = PNG.sync.read(png);
    let n = 0;
    for (let i = 3; i < d.data.length; i += 4) if ((d.data[i] ?? 0) > 0) n += 1;
    return n;
  }

  it('exposes the new color schemes with distinct floor colours', () => {
    const map = baseMap({ layers: [{ type: 'floor', runs: [[5, 5, 1]] }] });
    const flat = rgbAt(renderVacuumPng(map, { colorScheme: 'flat' }), 5, 14).slice(0, 3);
    const neon = rgbAt(renderVacuumPng(map, { colorScheme: 'dark-neon' }), 5, 14).slice(0, 3);
    const mat = rgbAt(renderVacuumPng(map, { colorScheme: 'materico' }), 5, 14).slice(0, 3);
    expect(flat).toEqual([236, 239, 241]);
    expect(neon).toEqual([16, 18, 27]);
    expect(mat).toEqual([245, 245, 245]);
  });

  it('draws room NAMES when showSegmentNames is set', () => {
    const named = baseMap({
      segments: [
        {
          id: 4,
          name: 'CUCINA',
          bbox: { xMin: 0, yMin: 0, xMax: 20, yMax: 20 },
          centroid: { x: 10, y: 10 },
          neighbours: [],
          floorMaterial: null,
          floorDirection: null,
          active: true,
        },
      ],
    });
    const withNames = countPainted(renderVacuumPng(named, { showSegmentNames: true, scale: 2 }));
    const plain = countPainted(renderVacuumPng(named, { scale: 2 }));
    // The 6-letter name paints far more than the 1-digit id would.
    expect(withNames).toBeGreaterThan(plain + 20);
  });

  it('colours obstacles by type (distinct types → distinct colours)', () => {
    const map = baseMap({
      obstacles: [
        { id: 1, x: 5, y: 5, type: 1, confidence: 90, photoFileName: null, photoKey: null },
        { id: 2, x: 12, y: 12, type: 40, confidence: 90, photoFileName: null, photoKey: null },
      ],
    });
    const png = renderVacuumPng(map, { colorObstaclesByType: true });
    const a = rgbAt(png, 5, 14); // (5,5) -> row 14
    const b = rgbAt(png, 12, 7); // (12,12) -> row 7
    expect(a[3]).toBe(255); // obstacle marker painted
    expect(b[3]).toBe(255);
    expect(a.slice(0, 3)).not.toEqual(b.slice(0, 3));
  });

  it('outlines furniture (low-lying) zones, gated on showFurniture', () => {
    const map = baseMap({
      lowLyingAreas: [
        {
          id: 1,
          points: [
            { x: 3, y: 3 },
            { x: 8, y: 3 },
            { x: 8, y: 8 },
            { x: 3, y: 8 },
          ],
        },
      ],
    });
    // Top edge y=3 -> pixel row 16; (5,16) sits on the outline.
    expect(rgbAt(renderVacuumPng(map), 5, 16)[3]).toBeGreaterThan(0);
    expect(rgbAt(renderVacuumPng(map, { showFurniture: false }), 5, 16)[3]).toBe(0);
  });

  it('tints the cleaned-area overlay, gated on showCleanedArea', () => {
    const map = baseMap({
      cleanedArea: {
        dimensions: { left: 0, top: 0, width: 20, height: 20, gridSize: 1 },
        cleaned: [[5, 5, 1]],
        dirty: [],
      },
    });
    // cleaned cell world (5,5) -> pixel row 14, translucent tint.
    expect(rgbAt(renderVacuumPng(map, { showCleanedArea: true }), 5, 14)[3]).toBeGreaterThan(0);
    expect(rgbAt(renderVacuumPng(map), 5, 14)[3]).toBe(0); // default off
  });
});
