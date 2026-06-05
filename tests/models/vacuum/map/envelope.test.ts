import { describe, it, expect } from 'vitest';
// NOTE: robots were asleep during e2e capture — these tests run against a
// SYNTHETIC byte-exact frame builder, not a guaranteed live blob. The
// AES-positive round-trip is fixture-limited (it needs a captured per-blob
// key + per-model IV we do not have); we lock the no-AES path and the
// key-without-IV guard here. The donor AES code is ported byte-for-byte, so
// the untested risk is import-rewrite only — NOT a behaviour change.
import { unwrapEnvelope, MapDecodeError } from '../../../../src/models/vacuum/map/envelope.js';
import { buildSyntheticFrame } from './fixtures/build-frame.js';

const frame = buildSyntheticFrame({
  mapId: 1,
  frameId: 0,
  frameType: 'I',
  robot: { x: 0, y: 0, a: 0 },
  charger: { x: 0, y: 0, a: 0 },
  gridSize: 50,
  width: 2,
  height: 2,
  left: 0,
  top: 0,
  grid: Buffer.from([0, 0, 0, 0]),
  tail: { timestamp_ms: 1 },
});

describe('unwrapEnvelope', () => {
  it('round-trips a urlsafe-base64 + zlib frame (no AES)', () => {
    const out = unwrapEnvelope(frame.envelope);
    expect(out.equals(frame.inflated)).toBe(true);
  });

  it('throws on empty payload', () => {
    expect(() => unwrapEnvelope('')).toThrow(MapDecodeError);
  });

  it('throws when an AES key is supplied without an IV', () => {
    expect(() => unwrapEnvelope(`${frame.envelope},somekey`)).toThrow(/no IV/);
  });

  it('throws MapDecodeError on a non-zlib payload (no AES)', () => {
    const garbage = Buffer.from('not actually zlib data').toString('base64');
    expect(() => unwrapEnvelope(garbage)).toThrow(MapDecodeError);
  });
});
