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
    // Top-left pixel (0,0) is a wall → opaque (alpha 255).
    const tl = (0 * decoded.width + 0) * 4;
    expect(decoded.data[tl + 3]).toBe(255);
    // Bottom-left pixel (0,1) is `outside`/0 → never painted → transparent.
    const bl = (1 * decoded.width + 0) * 4;
    expect(decoded.data[bl + 3]).toBe(0);
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
    const map = baseMap({ layers: [{ type: 'floor', runs: [[5, 5, 1]] }] });
    const light = rgbAt(renderVacuumPng(map, { colorScheme: 'dreame-light' }), 5, 5);
    const dark = rgbAt(renderVacuumPng(map, { colorScheme: 'dreame-dark' }), 5, 5);
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
    const map = baseMap({ dock: { x: 3, y: 3, angle: 0 } });
    expect(rgbAt(renderVacuumPng(map), 3, 3)[3]).toBe(255);
    expect(rgbAt(renderVacuumPng(map, { showCharger: false }), 3, 3)[3]).toBe(0);
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
    // A midpoint of the horizontal path is painted.
    expect(rgbAt(renderVacuumPng(map), 9, 10)[3]).toBeGreaterThan(0);
    expect(rgbAt(renderVacuumPng(map, { showPath: false }), 9, 10)[3]).toBe(0);
  });

  it('fills a no-go restricted area, gated on showNoGo', () => {
    const map = baseMap({
      restrictedAreas: [{ kind: 'noGo', bbox: { xMin: 4, yMin: 4, xMax: 9, yMax: 9 } }],
    });
    expect(rgbAt(renderVacuumPng(map), 6, 6)[3]).toBeGreaterThan(0);
    expect(rgbAt(renderVacuumPng(map, { showNoGo: false }), 6, 6)[3]).toBe(0);
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
