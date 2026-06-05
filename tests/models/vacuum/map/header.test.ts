import { describe, it, expect } from 'vitest';
// NOTE: robots were asleep during e2e capture — these tests run against a
// SYNTHETIC byte-exact frame builder, not a guaranteed live blob. If a real
// blob is captured it lands in ./fixtures/real-iframe.b64 (see decode.test.ts);
// that would be an ADDITIVE assertion, never a replacement for these.
import { parseMapHeader } from '../../../../src/models/vacuum/map/header.js';
import { buildSyntheticFrame } from './fixtures/build-frame.js';

describe('parseMapHeader', () => {
  it('parses the 27-byte little-endian header of a synthetic I-frame', () => {
    const { inflated } = buildSyntheticFrame({
      mapId: 7,
      frameId: 1,
      frameType: 'I',
      robot: { x: 100, y: -200, a: 90 },
      charger: { x: 0, y: 0, a: 0 },
      gridSize: 50,
      width: 4,
      height: 3,
      left: -1000,
      top: 2000,
      grid: Buffer.alloc(12), // width*height = 12 bytes
      tail: { timestamp_ms: 123, mra: 0 },
    });
    const h = parseMapHeader(inflated);
    expect(h).toMatchObject({
      mapId: 7,
      frameId: 1,
      frameType: 'I',
      robotX: 100,
      robotY: -200,
      robotA: 90,
      gridSize: 50,
      width: 4,
      height: 3,
      left: -1000,
      top: 2000,
    });
  });

  it('throws on a short buffer', () => {
    expect(() => parseMapHeader(Buffer.alloc(10))).toThrow(/need 27 bytes/);
  });
});
