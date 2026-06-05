import { describe, it, expect } from 'vitest';
// NOTE: robots were asleep during e2e capture — these tests run against
// SYNTHETIC I- and P-frames built with the shared frame builder, exercising
// the byte-add delta merge against known inputs, not a guaranteed live blob.
import {
  mergePFrame,
  mergePFrameEnvelope,
  OutOfOrderFrameError,
} from '../../../../src/models/vacuum/map/merge.js';
import { MapDecodeError, HEADER_SIZE } from '../../../../src/models/vacuum/map/envelope.js';
import { parseMapHeader } from '../../../../src/models/vacuum/map/header.js';
import { parseFrame } from '../../../../src/models/vacuum/map/tail.js';
import { buildSyntheticFrame } from './fixtures/build-frame.js';

function gridFrom(values: number[]): Buffer {
  return Buffer.from(values);
}

describe('mergePFrame', () => {
  it('byte-adds aligned P-frame deltas onto prev, re-stamps as I, concatenates tr', () => {
    const prev = buildSyntheticFrame({
      mapId: 5,
      frameId: 0,
      frameType: 'I',
      robot: { x: 10, y: 10, a: 0 },
      charger: { x: 0, y: 0, a: 0 },
      gridSize: 50,
      width: 4,
      height: 4,
      left: 0,
      top: 0,
      grid: gridFrom([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
      tail: { timestamp_ms: 1, tr: 'S100,100', seg_inf: { '5': {} }, sa: [[5]], origin: [0, 0] },
    });
    const p = buildSyntheticFrame({
      mapId: 5,
      frameId: 1,
      frameType: 'P',
      robot: { x: 20, y: 20, a: 0 },
      charger: { x: 0, y: 0, a: 0 },
      gridSize: 50,
      width: 4,
      height: 4,
      left: 0,
      top: 0,
      // delta: +1 everywhere
      grid: gridFrom([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
      tail: { timestamp_ms: 2, tr: 'L10,0', origin: [0, 0] },
    });

    const merged = mergePFrame(prev.inflated, p.inflated);
    const header = parseMapHeader(merged);
    expect(header.frameType).toBe('I'); // re-stamped
    expect(header.frameId).toBe(1); // advanced to P
    expect(header.mapId).toBe(5);
    expect(header.width).toBe(4);
    expect(header.height).toBe(4);

    const pixels = merged.subarray(HEADER_SIZE, HEADER_SIZE + 16);
    expect([...pixels]).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);

    const { tail } = parseFrame(merged);
    expect(tail.tr).toBe('S100,100L10,0'); // prev.tr + p.tr
    expect(tail.seg_inf).toEqual({ '5': {} }); // fell back to prev
    expect(tail.sa).toEqual([[5]]); // fell back to prev
    expect(tail.origin).toEqual([0, 0]); // union origin
  });

  it('byte-add wraps at 0xff', () => {
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
      grid: gridFrom([250]),
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
      grid: gridFrom([10]),
      tail: { origin: [0, 0] },
    });
    const merged = mergePFrame(prev.inflated, p.inflated);
    expect(merged[HEADER_SIZE]).toBe((250 + 10) & 0xff); // 4
  });

  it('pose-only P-frame (width 0, height 0) merges with no pixel change', () => {
    const prev = buildSyntheticFrame({
      mapId: 2,
      frameId: 7,
      frameType: 'I',
      robot: { x: 0, y: 0, a: 0 },
      charger: { x: 0, y: 0, a: 0 },
      gridSize: 50,
      width: 2,
      height: 2,
      left: 0,
      top: 0,
      grid: gridFrom([1, 2, 3, 4]),
      tail: { origin: [0, 0] },
    });
    const p = buildSyntheticFrame({
      mapId: 2,
      frameId: 8,
      frameType: 'P',
      robot: { x: 99, y: 99, a: 0 },
      charger: { x: 0, y: 0, a: 0 },
      gridSize: 50,
      width: 0,
      height: 0,
      left: 0,
      top: 0,
      grid: Buffer.alloc(0),
      tail: { origin: [0, 0] },
    });
    const merged = mergePFrame(prev.inflated, p.inflated);
    const header = parseMapHeader(merged);
    expect(header.width).toBe(2);
    expect(header.height).toBe(2);
    expect(header.robotX).toBe(99);
    expect([...merged.subarray(HEADER_SIZE, HEADER_SIZE + 4)]).toEqual([1, 2, 3, 4]);
  });

  it('throws OutOfOrderFrameError on a non-sequential frame id', () => {
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
      grid: gridFrom([1]),
      tail: { origin: [0, 0] },
    });
    const p = buildSyntheticFrame({
      mapId: 1,
      frameId: 5, // gap
      frameType: 'P',
      robot: { x: 0, y: 0, a: 0 },
      charger: { x: 0, y: 0, a: 0 },
      gridSize: 50,
      width: 1,
      height: 1,
      left: 0,
      top: 0,
      grid: gridFrom([1]),
      tail: { origin: [0, 0] },
    });
    expect(() => mergePFrame(prev.inflated, p.inflated)).toThrow(OutOfOrderFrameError);
  });

  it('throws MapDecodeError on map_id mismatch / non-P input / grid_size change', () => {
    const base = (over: {
      mapId: number;
      frameId: number;
      frameType: 'I' | 'P';
      gridSize: number;
    }) =>
      buildSyntheticFrame({
        ...over,
        robot: { x: 0, y: 0, a: 0 },
        charger: { x: 0, y: 0, a: 0 },
        width: 1,
        height: 1,
        left: 0,
        top: 0,
        grid: gridFrom([1]),
        tail: { origin: [0, 0] },
      });

    const prev = base({ mapId: 1, frameId: 0, frameType: 'I', gridSize: 50 });

    // non-P input
    const notP = base({ mapId: 1, frameId: 1, frameType: 'I', gridSize: 50 });
    expect(() => mergePFrame(prev.inflated, notP.inflated)).toThrow(MapDecodeError);

    // map_id mismatch
    const otherMap = base({ mapId: 2, frameId: 1, frameType: 'P', gridSize: 50 });
    expect(() => mergePFrame(prev.inflated, otherMap.inflated)).toThrow(MapDecodeError);

    // grid_size change
    const otherGrid = base({ mapId: 1, frameId: 1, frameType: 'P', gridSize: 25 });
    expect(() => mergePFrame(prev.inflated, otherGrid.inflated)).toThrow(MapDecodeError);
  });

  it('mergePFrameEnvelope accepts envelope strings', () => {
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
      grid: gridFrom([5]),
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
      grid: gridFrom([3]),
      tail: { origin: [0, 0] },
    });
    const merged = mergePFrameEnvelope(prev.envelope, p.envelope);
    expect(merged[HEADER_SIZE]).toBe(8);
  });
});
