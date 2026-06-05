import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
// NOTE: robots were asleep during e2e capture — these tests render a SYNTHETIC
// I-frame decoded from the shared frame builder, not a guaranteed live blob.
// Assertions are STRUCTURAL (PNG signature + dimensions), not pixel-exact.
import { decodeVacuumMap } from '../../../../src/models/vacuum/map/decode.js';
import { renderVacuumPng } from '../../../../src/models/vacuum/map/render.js';
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
    const decoded = PNG.sync.read(renderVacuumPng(map));
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
    const decoded = PNG.sync.read(renderVacuumPng(map));
    const a = [decoded.data[0], decoded.data[1], decoded.data[2]];
    const b = [decoded.data[4], decoded.data[5], decoded.data[6]];
    expect(a).not.toEqual(b);
    expect(decoded.data[3]).toBe(255);
    expect(decoded.data[7]).toBe(255);
  });
});
