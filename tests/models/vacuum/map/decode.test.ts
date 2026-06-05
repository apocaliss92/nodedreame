import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// NOTE: robots were asleep during e2e capture — these tests run against a
// SYNTHETIC full I-frame built with the shared frame builder. If a real
// blob is captured it lands in ./fixtures/real-iframe.b64 and the extra
// assertion at the bottom runs; until then the synthetic builder is the
// source of truth.
import { decodeVacuumMap, applyVacuumPFrame } from '../../../../src/models/vacuum/map/decode.js';
import { buildSyntheticFrame } from './fixtures/build-frame.js';

const WALL = 63 << 2; // 252
const FLOOR = 62 << 2; // 248
const SEG5 = 5 << 2; // 20

function fullIFrame() {
  // 4-wide x 3-tall grid:
  //   row 0: wall  wall  wall  wall
  //   row 1: floor floor seg5  seg5
  //   row 2: 0     0     seg5  seg5
  const grid = Buffer.from([WALL, WALL, WALL, WALL, FLOOR, FLOOR, SEG5, SEG5, 0, 0, SEG5, SEG5]);
  return buildSyntheticFrame({
    mapId: 7,
    frameId: 1,
    frameType: 'I',
    robot: { x: 120, y: -240, a: 90 },
    charger: { x: 0, y: 0, a: 0 },
    gridSize: 50,
    width: 4,
    height: 3,
    left: -100,
    top: 200,
    grid,
    tail: {
      timestamp_ms: 123456,
      mra: 90,
      oc: true,
      tr: 'S100,200S110,210',
      ai_obstacle: [['1000', '2000', '3', '0.9', '0', 'p.jpg', '11']],
      vw: { line: [[0, 0, 10, 20]] },
      seg_inf: { '5': { name: '' } },
      sa: [[5]],
      origin: [-100, 200],
    },
  });
}

describe('decodeVacuumMap', () => {
  it('decodes a full synthetic I-frame from an envelope string', () => {
    const { envelope } = fullIFrame();
    const map = decodeVacuumMap(envelope);

    expect(map.mapId).toBe(7);
    expect(map.frameId).toBe(1);
    expect(map.frameType).toBe('I');
    expect(map.timestamp).toBe(123456);
    expect(map.rotation).toBe(90);
    expect(map.dimensions).toEqual({
      left: -100,
      top: 200,
      width: 4,
      height: 3,
      gridSize: 50,
    });
    expect(map.robot).toEqual({ x: 120, y: -240, angle: 90 });
    expect(map.dock).toEqual({ x: 0, y: 0, angle: 0 });
    expect(map.docked).toBe(true);

    expect(map.layers.length).toBeGreaterThan(0);
    expect(map.layers.some((l) => l.type === 'wall')).toBe(true);
    expect(map.layers.some((l) => l.type === 'floor')).toBe(true);
    expect(map.layers.some((l) => l.type === 'segment')).toBe(true);

    expect(map.segments.length).toBe(1);
    expect(map.segments[0]?.id).toBe(5);

    expect(map.paths.length).toBe(1);
    expect(map.paths[0]?.type).toBe('sweep');

    expect(map.obstacles.length).toBe(1);
    expect(map.obstacles[0]?.id).toBe(11);

    expect(map.virtualWalls.length).toBe(1);
    expect(map.cleanedArea).toBeNull();
  });

  it('decodes the same frame from a Buffer (inflated) input', () => {
    const { inflated } = fullIFrame();
    const map = decodeVacuumMap(inflated);
    expect(map.mapId).toBe(7);
    expect(map.layers.length).toBeGreaterThan(0);
    expect(map.segments.length).toBe(1);
  });

  it('returns null poses when nr / nc flags are set', () => {
    const { envelope } = buildSyntheticFrame({
      mapId: 1,
      frameId: 0,
      frameType: 'I',
      robot: { x: 0, y: 0, a: 0 },
      charger: { x: 0, y: 0, a: 0 },
      gridSize: 50,
      width: 1,
      height: 1,
      left: 0,
      top: 0,
      grid: Buffer.from([FLOOR]),
      tail: { nr: true, nc: true },
    });
    const map = decodeVacuumMap(envelope);
    expect(map.robot).toBeNull();
    expect(map.dock).toBeNull();
  });

  it('skips pixel decode on a P-frame (empty layers)', () => {
    const { inflated } = buildSyntheticFrame({
      mapId: 1,
      frameId: 2,
      frameType: 'P',
      robot: { x: 0, y: 0, a: 0 },
      charger: { x: 0, y: 0, a: 0 },
      gridSize: 50,
      width: 2,
      height: 1,
      left: 0,
      top: 0,
      grid: Buffer.from([1, 2]),
      tail: { tr: 'L1,1' },
    });
    const map = decodeVacuumMap(inflated);
    expect(map.layers).toEqual([]);
    expect(map.segments).toEqual([]);
    // path / obstacles / geometry still parse on a P-frame
    expect(map.paths.length).toBe(1);
  });
});

describe('applyVacuumPFrame', () => {
  it('merges a synthetic P-frame onto a decoded I-frame and decodes the merged pixels', () => {
    const prev = buildSyntheticFrame({
      mapId: 9,
      frameId: 0,
      frameType: 'I',
      robot: { x: 0, y: 0, a: 0 },
      charger: { x: 0, y: 0, a: 0 },
      gridSize: 50,
      width: 2,
      height: 1,
      left: 0,
      top: 0,
      grid: Buffer.from([FLOOR, FLOOR]),
      tail: { tr: 'S0,0', origin: [0, 0] },
    });
    const p = buildSyntheticFrame({
      mapId: 9,
      frameId: 1,
      frameType: 'P',
      robot: { x: 50, y: 50, a: 0 },
      charger: { x: 0, y: 0, a: 0 },
      gridSize: 50,
      width: 2,
      height: 1,
      left: 0,
      top: 0,
      // delta turns FLOOR(248) pixel 0 into WALL(252): +4
      grid: Buffer.from([4, 0]),
      tail: { tr: 'L10,0', origin: [0, 0] },
    });

    const { buffer, data } = applyVacuumPFrame(prev.envelope, p.envelope);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(data.frameId).toBe(1);
    expect(data.frameType).toBe('I'); // merged buffer re-stamped
    expect(data.layers.length).toBeGreaterThan(0);
    expect(data.layers.some((l) => l.type === 'wall')).toBe(true);
    expect(data.layers.some((l) => l.type === 'floor')).toBe(true);
    // tr concatenated 'S0,0' + 'L10,0' → a sweep path then an unwound line path
    expect(data.paths.length).toBe(2);
    expect(data.paths[0]?.type).toBe('sweep');
    expect(data.paths[1]?.type).toBe('line');
  });

  it('accepts already-inflated Buffer inputs', () => {
    const prev = buildSyntheticFrame({
      mapId: 1,
      frameId: 0,
      frameType: 'I',
      robot: { x: 0, y: 0, a: 0 },
      charger: { x: 0, y: 0, a: 0 },
      gridSize: 50,
      width: 1,
      height: 1,
      left: 0,
      top: 0,
      grid: Buffer.from([FLOOR]),
      tail: { origin: [0, 0] },
    });
    const p = buildSyntheticFrame({
      mapId: 1,
      frameId: 1,
      frameType: 'P',
      robot: { x: 0, y: 0, a: 0 },
      charger: { x: 0, y: 0, a: 0 },
      gridSize: 50,
      width: 1,
      height: 1,
      left: 0,
      top: 0,
      grid: Buffer.from([0]),
      tail: { origin: [0, 0] },
    });
    const { data } = applyVacuumPFrame(prev.inflated, p.inflated);
    expect(data.frameId).toBe(1);
  });
});

describe('real captured I-frame (optional)', () => {
  const realPath = fileURLToPath(new URL('./fixtures/real-iframe.b64', import.meta.url));
  if (existsSync(realPath)) {
    it('decodes a real captured I-frame with positive dimensions', () => {
      const b64 = readFileSync(realPath, 'utf8').trim();
      expect(decodeVacuumMap(b64).dimensions.width).toBeGreaterThan(0);
    });
  } else {
    it.skip('real-iframe.b64 fixture unavailable (robots asleep during capture)', () => {
      // Intentionally skipped — no live blob captured. The synthetic
      // frame builder above is the source of truth.
    });
  }
});
