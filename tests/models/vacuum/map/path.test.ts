import { describe, it, expect } from 'vitest';
// NOTE: robots were asleep during e2e capture — this exercises the `tr`
// cleaning-path parser against hand-written op sequences, not a live blob. A
// real captured `tr` would be an additive assertion (see decode.test.ts).
import { parsePathTr } from '../../../../src/models/vacuum/map/path.js';

describe('parsePathTr', () => {
  it('returns [] for an empty string', () => {
    expect(parsePathTr('')).toEqual([]);
  });

  it('parses absolute sweep waypoints into one sweep path', () => {
    const paths = parsePathTr('S100,200S110,210');
    expect(paths).toHaveLength(1);
    expect(paths[0]).toEqual({
      type: 'sweep',
      points: [
        { x: 100, y: 200 },
        { x: 110, y: 210 },
      ],
    });
  });

  it('unwinds relative line deltas against the preceding anchor (lowercase l == L)', () => {
    const paths = parsePathTr('S100,100L10,0l0,10');
    expect(paths).toHaveLength(2);
    expect(paths[0]).toEqual({ type: 'sweep', points: [{ x: 100, y: 100 }] });
    // line is RELATIVE: anchor (100,100) +(10,0) = (110,100); seeded with the
    // anchor, then +(0,10) = (110,110).
    expect(paths[1]).toEqual({
      type: 'line',
      points: [
        { x: 100, y: 100 },
        { x: 110, y: 100 },
        { x: 110, y: 110 },
      ],
    });
  });

  it('emits leading line ops literally when there is no preceding anchor', () => {
    const paths = parsePathTr('L5,7l1,1');
    expect(paths).toHaveLength(1);
    // No anchor yet: `line` ops do NOT update the anchor, so both points are
    // emitted literally as-written (the merge layer always prepends an absolute
    // waypoint upstream, so consumers never see this raw path).
    expect(paths[0]).toEqual({
      type: 'line',
      points: [
        { x: 5, y: 7 },
        { x: 1, y: 1 },
      ],
    });
  });
});
