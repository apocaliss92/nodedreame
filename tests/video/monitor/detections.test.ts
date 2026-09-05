import { describe, it, expect } from 'vitest';
import { parsePersonFollow, parseObstacleData } from '../../../src/video/monitor/detections.js';

describe('detection parsers', () => {
  it('parsePersonFollow reads a bbox and scales ns timestamps to ms', () => {
    const ns = 1_700_000_000_000_000_000; // nanoseconds
    const d = parsePersonFollow(JSON.stringify({ timestamp: ns, bbox: [10, 20, 30, 40] }));
    expect(d).not.toBeNull();
    expect(d!.timestampMs).toBe(Math.round(ns / 1e6));
    expect(d!.box).toEqual({ x: 10, y: 20, w: 30, h: 40 });
  });

  it('parsePersonFollow accepts object bbox with label/score', () => {
    const d = parsePersonFollow({ time: 1700, box: { x: 1, y: 2, width: 3, height: 4, label: 'person', confidence: 0.9 } });
    expect(d!.box).toEqual({ x: 1, y: 2, w: 3, h: 4, label: 'person', score: 0.9 });
    expect(d!.timestampMs).toBe(1700); // already ms, left as-is
  });

  it('parsePersonFollow returns null on garbage', () => {
    expect(parsePersonFollow('not json')).toBeNull();
    expect(parsePersonFollow(42)).toBeNull();
  });

  it('parseObstacleData reads a box list, skipping malformed entries', () => {
    const d = parseObstacleData(
      JSON.stringify({ timestamp: 1000, boxlist: [[1, 2, 3, 4], { x: 5, y: 6, w: 7, h: 8 }, { bad: true }] }),
    );
    expect(d).not.toBeNull();
    expect(d!.boxes).toEqual([
      { x: 1, y: 2, w: 3, h: 4 },
      { x: 5, y: 6, w: 7, h: 8 },
    ]);
  });

  it('parseObstacleData tolerates an empty/missing list', () => {
    expect(parseObstacleData(JSON.stringify({ timestamp: 1 }))!.boxes).toEqual([]);
    expect(parseObstacleData('nope')).toBeNull();
  });
});
