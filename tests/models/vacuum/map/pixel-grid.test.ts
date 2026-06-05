import { describe, it, expect } from 'vitest';
// NOTE: robots were asleep during e2e capture — this exercises the fsm:1
// pixel-grid decoder against a hand-built grid with known bytes, not a live
// blob. A real captured frame would be an additive assertion (see
// decode.test.ts).
import {
  classifyPixelFsm1,
  decodePixelGridFsm1,
  collectSegments,
} from '../../../../src/models/vacuum/map/pixel-grid.js';
import type { MapDimensions, MapLayer, MapTail } from '../../../../src/models/vacuum/map/types.js';

describe('classifyPixelFsm1', () => {
  it('classifies every documented branch', () => {
    expect(classifyPixelFsm1(0)).toEqual({ kind: 'outside' });
    expect(classifyPixelFsm1(63 << 2)).toEqual({ kind: 'wall' });
    expect(classifyPixelFsm1(62 << 2)).toEqual({ kind: 'floor' });
    expect(classifyPixelFsm1(61 << 2)).toEqual({ kind: 'outside' });
    expect(classifyPixelFsm1((0 << 2) | 2)).toEqual({ kind: 'wall' });
    expect(classifyPixelFsm1((0 << 2) | 3)).toEqual({ kind: 'outside', carpet: true });
    expect(classifyPixelFsm1(5 << 2)).toEqual({ kind: 'segment', segmentId: 5 });
    expect(classifyPixelFsm1((5 << 2) | 3)).toEqual({
      kind: 'segment',
      segmentId: 5,
      carpet: true,
    });
    // carpet overlay on the special wall/floor ids
    expect(classifyPixelFsm1((63 << 2) | 3)).toEqual({ kind: 'wall', carpet: true });
    expect(classifyPixelFsm1((62 << 2) | 3)).toEqual({ kind: 'floor', carpet: true });
  });
});

describe('decodePixelGridFsm1', () => {
  it('emits run-length layers that do not cross row boundaries', () => {
    // 4x2 grid:
    // row0: wall  wall  floor seg5
    // row1: seg5  seg5  out   carpet-floor
    const W = 63 << 2;
    const F = 62 << 2;
    const S = 5 << 2;
    const CF = (62 << 2) | 3; // carpet floor
    const grid = Buffer.from([W, W, F, S, S, S, 0, CF]);
    const layers = decodePixelGridFsm1(grid, 4, 2);

    const wall = layers.find((l) => l.type === 'wall');
    const floor = layers.find((l) => l.type === 'floor');
    const seg = layers.find((l) => l.type === 'segment');
    const carpet = layers.find((l) => l.type === 'carpet');

    expect(wall?.runs).toEqual([[0, 0, 2]]);
    // floor pixel at (2,0) plus the carpet-floor at (3,1)
    expect(floor?.runs).toEqual([
      [2, 0, 1],
      [3, 1, 1],
    ]);
    expect(seg?.segmentId).toBe(5);
    // seg5 at (3,0) then (0,1)-(1,1); runs must not cross the row boundary
    expect(seg?.runs).toEqual([
      [3, 0, 1],
      [0, 1, 2],
    ]);
    expect(carpet?.runs).toEqual([[3, 1, 1]]);
  });

  it('sorts segment layers by id and places carpet last', () => {
    const s5 = 5 << 2;
    const s7 = 7 << 2;
    const grid = Buffer.from([s7, s5]); // 2x1, seg7 then seg5
    const layers = decodePixelGridFsm1(grid, 2, 1);
    const types = layers.map((l) => (l.type === 'segment' ? `seg${l.segmentId}` : l.type));
    expect(types).toEqual(['seg5', 'seg7']);
  });
});

describe('collectSegments', () => {
  const dim: MapDimensions = { left: 1000, top: 2000, width: 4, height: 2, gridSize: 50 };

  it('computes bbox/centroid in mm world-frame, decodes name, and sets active from sa', () => {
    // segment 5 occupies pixels (0,0) and (1,0): a 2-pixel horizontal run.
    const layers: MapLayer[] = [{ type: 'segment', segmentId: 5, runs: [[0, 0, 2]] }];
    const name = Buffer.from('Kitchen', 'utf8').toString('base64');
    const tail: MapTail = {
      seg_inf: { '5': { name, nei_id: [6], material: 2, direction: 1 } },
      sa: [[5]],
    };
    const segs = collectSegments(layers, dim, tail);
    expect(segs).toHaveLength(1);
    const s = segs[0]!;
    expect(s.id).toBe(5);
    expect(s.name).toBe('Kitchen');
    expect(s.neighbours).toEqual([6]);
    expect(s.floorMaterial).toBe(2);
    expect(s.floorDirection).toBe(1);
    expect(s.active).toBe(true);
    // bbox: xMin = left + 0*grid = 1000; xMax = left + (1+1)*grid = 1100; row 0.
    expect(s.bbox).toEqual({ xMin: 1000, yMin: 2000, xMax: 1100, yMax: 2050 });
    // centroid x = left + (mean px)*grid = 1000 + 0.5*50 = 1025; y = 2000.
    expect(s.centroid).toEqual({ x: 1025, y: 2000 });
  });

  it('returns name null when seg_inf is missing and active false when not in sa', () => {
    const layers: MapLayer[] = [{ type: 'segment', segmentId: 9, runs: [[0, 0, 1]] }];
    const segs = collectSegments(layers, dim, {});
    expect(segs[0]?.name).toBeNull();
    expect(segs[0]?.active).toBe(false);
    expect(segs[0]?.neighbours).toEqual([]);
  });
});
