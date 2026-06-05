import { describe, it, expect } from 'vitest';
// NOTE: robots were asleep during e2e capture — these tests run against
// SYNTHETIC `vw` / `vws` / `walls_info` / sneak blocks modelled on the
// documented r2532a wire shapes, not a guaranteed live blob.
import {
  parseVirtualWalls,
  parseWallsInfo,
  parseLowLyingAreas,
  parseTailGeometry,
  isGeometryComplete,
  coalesceGeometry,
  type MapGeometry,
} from '../../../../src/models/vacuum/map/geometry.js';
import type { MapTail } from '../../../../src/models/vacuum/map/types.js';

describe('parseVirtualWalls', () => {
  it('parses vw.line as a wall (kind absent when default)', () => {
    const { virtualWalls, restrictedAreas } = parseVirtualWalls({ line: [[0, 0, 10, 20]] });
    expect(restrictedAreas).toEqual([]);
    expect(virtualWalls).toHaveLength(1);
    expect(virtualWalls[0]).toEqual({ from: { x: 0, y: 0 }, to: { x: 10, y: 20 } });
    expect('kind' in virtualWalls[0]!).toBe(false);
  });

  it('parses vw.rect / vw.mop / vw.nocpt into restricted areas with sorted bbox + optional angle', () => {
    const { restrictedAreas } = parseVirtualWalls({
      rect: [[30, 40, 10, 20, 45]],
      mop: [[5, 5, 1, 1]],
      nocpt: [[100, 200, 300, 400]],
    });
    expect(restrictedAreas).toHaveLength(3);
    expect(restrictedAreas[0]).toEqual({
      kind: 'noGo',
      bbox: { xMin: 10, yMin: 20, xMax: 30, yMax: 40 },
      angle: 45,
    });
    expect(restrictedAreas[1]).toEqual({
      kind: 'noMop',
      bbox: { xMin: 1, yMin: 1, xMax: 5, yMax: 5 },
    });
    expect(restrictedAreas[2]).toMatchObject({ kind: 'noGo' });
  });

  it('vws.vwsl WITHOUT npthrsd yields a threshold with no passable hint', () => {
    const { virtualWalls } = parseVirtualWalls(undefined, { vwsl: [[0, 0, 1, 1]] });
    expect(virtualWalls).toHaveLength(1);
    expect(virtualWalls[0]).toEqual({
      from: { x: 0, y: 0 },
      to: { x: 1, y: 1 },
      kind: 'threshold',
    });
    expect('passable' in virtualWalls[0]!).toBe(false);
  });

  it('vws.vwsl WITH npthrsd present marks vwsl passable and npthrsd impassable', () => {
    const { virtualWalls } = parseVirtualWalls(undefined, {
      vwsl: [[0, 0, 1, 1]],
      npthrsd: [[2, 2, 3, 3]],
    });
    expect(virtualWalls).toHaveLength(2);
    expect(virtualWalls[0]).toMatchObject({ kind: 'threshold', passable: true });
    expect(virtualWalls[1]).toMatchObject({ kind: 'threshold', passable: false });
  });

  it('skips malformed lines / rects', () => {
    const { virtualWalls, restrictedAreas } = parseVirtualWalls({
      line: [[0, 0, 10]], // too short
      rect: [[NaN, 0, 1, 2]], // non-finite first corner
    });
    expect(virtualWalls).toEqual([]);
    expect(restrictedAreas).toEqual([]);
  });
});

describe('parseWallsInfo', () => {
  it('parses a one-storey/one-room/one-wall object', () => {
    const info = parseWallsInfo({
      version_flag: 3,
      storeys: [
        {
          rooms: [
            {
              room_id: 10,
              walls: [
                {
                  type: 0,
                  beg_pt_x: -8225,
                  beg_pt_y: 9275,
                  end_pt_x: -9025,
                  end_pt_y: 9275,
                  normal_x: 0,
                  normal_y: -1,
                },
              ],
            },
          ],
        },
      ],
    });
    expect(info).toEqual({
      versionFlag: 3,
      storeys: [
        {
          rooms: [
            {
              roomId: 10,
              walls: [
                {
                  type: 0,
                  from: { x: -8225, y: 9275 },
                  to: { x: -9025, y: 9275 },
                  normal: { x: 0, y: -1 },
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('returns null for missing / empty storeys', () => {
    expect(parseWallsInfo(undefined)).toBeNull();
    expect(parseWallsInfo({ storeys: [] })).toBeNull();
  });
});

describe('parseLowLyingAreas', () => {
  it('prefers sneak_areas_end over sneak_areas and surfaces area', () => {
    const out = parseLowLyingAreas(
      [{ id: 1, roi: [0, 0, 10, 0, 10, 10, 0, 10], area: 100 }],
      [{ id: 2, roi: [5, 5, 6, 6] }],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      id: 1,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      area: 100,
    });
  });

  it('falls back to sneak_areas when end is absent', () => {
    const out = parseLowLyingAreas(undefined, [{ id: 2, roi: [5, 5, 6, 6] }]);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe(2);
  });

  it('skips odd-length / short roi (donor requires >= 4 ints = >= 2 points)', () => {
    expect(parseLowLyingAreas([{ roi: [0, 0, 10] }], undefined)).toEqual([]); // odd length
    expect(parseLowLyingAreas([{ roi: [0, 0] }], undefined)).toEqual([]); // < 4 ints
    expect(parseLowLyingAreas([{ roi: [NaN, 0, 1, 2] }], undefined)).toEqual([]); // non-finite point
  });
});

const FULL: MapGeometry = {
  virtualWalls: [{ from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }],
  restrictedAreas: [{ kind: 'noGo', bbox: { xMin: 0, yMin: 0, xMax: 1, yMax: 1 } }],
  lowLyingAreas: [{ id: 1, points: [{ x: 0, y: 0 }] }],
  wallsInfo: { versionFlag: 0, storeys: [] },
};

describe('parseTailGeometry / isGeometryComplete / coalesceGeometry', () => {
  it('parseTailGeometry pulls every block from a tail', () => {
    const tail: MapTail = {
      vw: { line: [[0, 0, 1, 1]] },
      walls_info: {
        storeys: [{ rooms: [{ room_id: 1, walls: [] }] }],
      },
    };
    const g = parseTailGeometry(tail);
    expect(g.virtualWalls).toHaveLength(1);
    expect(g.wallsInfo).not.toBeNull();
  });

  it('isGeometryComplete requires every field non-empty', () => {
    expect(isGeometryComplete(FULL)).toBe(true);
    expect(isGeometryComplete({ ...FULL, virtualWalls: [] })).toBe(false);
    expect(isGeometryComplete({ ...FULL, wallsInfo: null })).toBe(false);
  });

  it('coalesceGeometry: primary wins per-field, fallback fills the rest', () => {
    const empty: MapGeometry = {
      virtualWalls: [],
      restrictedAreas: [],
      lowLyingAreas: [],
      wallsInfo: null,
    };
    const merged = coalesceGeometry(empty, FULL);
    expect(merged).toEqual(FULL);

    const primaryWins = coalesceGeometry(FULL, empty);
    expect(primaryWins).toEqual(FULL);
  });
});
