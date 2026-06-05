import { describe, it, expect } from 'vitest';
// NOTE: robots were asleep during e2e capture — these tests run against a
// SYNTHETIC inner `decmap` blob built with the shared frame builder, not a
// guaranteed live blob. The inner pixel encoding uses only the low 2 bits
// (1 = cleaned, 2 = dirty).
import { parseCleanedAreaOverlay } from '../../../../src/models/vacuum/map/cleaned-area.js';
import { buildSyntheticFrame } from './fixtures/build-frame.js';

describe('parseCleanedAreaOverlay', () => {
  it('decodes a recursive decmap blob into cleaned / dirty run-lists', () => {
    // 4-wide x 2-tall inner grid:
    //   row 0: cleaned cleaned dirty   .      → cleaned [0,0,2], dirty [2,0,1]
    //   row 1: .       dirty   dirty   cleaned → dirty [1,1,2], cleaned [3,1,1]
    const grid = Buffer.from([1, 1, 2, 0, 0, 2, 2, 1]);
    const { envelope } = buildSyntheticFrame({
      mapId: 1,
      frameId: 0,
      frameType: 'I',
      robot: { x: 0, y: 0, a: 0 },
      charger: { x: 0, y: 0, a: 0 },
      gridSize: 50,
      width: 4,
      height: 2,
      left: -100,
      top: 200,
      grid,
      tail: { CleanArea: [[5, 1234]] },
    });

    const overlay = parseCleanedAreaOverlay(envelope);
    expect(overlay).not.toBeNull();
    expect(overlay?.dimensions).toEqual({
      left: -100,
      top: 200,
      width: 4,
      height: 2,
      gridSize: 50,
    });
    expect(overlay?.cleaned).toEqual([
      [0, 0, 2],
      [3, 1, 1],
    ]);
    expect(overlay?.dirty).toEqual([
      [2, 0, 1],
      [1, 1, 2],
    ]);
    expect(overlay?.cleanedSegments).toEqual([[5, 1234]]);
  });

  it('omits cleanedSegments when the inner tail has no CleanArea', () => {
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
      grid: Buffer.from([1, 2]),
      tail: { timestamp_ms: 1 },
    });
    const overlay = parseCleanedAreaOverlay(envelope);
    expect(overlay).not.toBeNull();
    expect(overlay?.cleanedSegments).toBeUndefined();
    expect(overlay?.cleaned).toEqual([[0, 0, 1]]);
    expect(overlay?.dirty).toEqual([[1, 0, 1]]);
  });

  it('returns null for an empty / malformed decmap string', () => {
    expect(parseCleanedAreaOverlay('')).toBeNull();
    expect(parseCleanedAreaOverlay('not-base64-zlib!!!')).toBeNull();
  });
});
