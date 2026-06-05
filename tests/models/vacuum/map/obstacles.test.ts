import { describe, it, expect } from 'vitest';
// NOTE: robots were asleep during e2e capture — these tests run against
// SYNTHETIC positional `ai_obstacle` records modelled on the documented
// r2532a wire layout, not a guaranteed live blob.
import { parseObstacles } from '../../../../src/models/vacuum/map/obstacles.js';

describe('parseObstacles', () => {
  it('decodes a well-formed 14-field positional entry', () => {
    const entry = [
      '1200', // [0] x mm
      '-3400', // [1] y mm
      '7', // [2] type id
      '0.83', // [3] confidence 0-1
      '1714600000.123456', // [4] timestamp.usec
      'obstacle/photo-7.jpg', // [5] photo file path
      '42', // [6] photo id → id
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
    ];
    const out = parseObstacles([entry]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      id: 42,
      x: 1200,
      y: -3400,
      type: 7,
      confidence: 83, // 0.83 * 100, rounded
      photoFileName: 'obstacle/photo-7.jpg',
      photoKey: null,
    });
  });

  it('skips entries shorter than 6 fields', () => {
    const out = parseObstacles([['1', '2', '3', '4', '5']]);
    expect(out).toEqual([]);
  });

  it('skips entries with non-numeric x / y / type', () => {
    expect(parseObstacles([['x', '2', '3', '0.5', '0', 'p', '1']])).toEqual([]);
    expect(parseObstacles([['1', 'y', '3', '0.5', '0', 'p', '1']])).toEqual([]);
    expect(parseObstacles([['1', '2', 'z', '0.5', '0', 'p', '1']])).toEqual([]);
  });

  it('falls back to confidence 0 when the field is absent / non-numeric', () => {
    const out = parseObstacles([['1', '2', '3', 'n/a', '0', 'p.jpg', '9']]);
    expect(out).toHaveLength(1);
    expect(out[0]?.confidence).toBe(0);
  });

  it('skips non-array entries', () => {
    expect(parseObstacles(['nope', 123, null])).toEqual([]);
  });

  it('derives id from the timestamp when the photo id is absent', () => {
    const out = parseObstacles([['10', '20', '1', '0.5', '2.5', 'p.jpg']]);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe(Math.round(2.5 * 1e6));
  });
});
