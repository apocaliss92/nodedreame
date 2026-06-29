import { describe, it, expect } from 'vitest';
import { createCipheriv, createHash } from 'node:crypto';
import * as zlib from 'node:zlib';
// NOTE: robots were asleep during e2e capture — these tests run against a
// SYNTHETIC byte-exact frame builder, not a guaranteed live blob. The
// AES path is exercised by SYNTHETICALLY encrypting a frame with the SAME
// key-derivation scheme `aesCbcDecrypt` uses (sha256(key)[:32] utf8 key,
// raw 16-byte utf8 IV, AES-256-CBC, no auto-padding) and asserting the
// decrypt+inflate round-trips. This proves the cipher setup is internally
// consistent and catches any port error — beyond the no-AES path and the
// key-without-IV guard which were already locked here.
import {
  unwrapEnvelope,
  looksLikeBase64Zlib,
  MapDecodeError,
} from '../../../../src/models/vacuum/map/envelope.js';
import { buildSyntheticFrame } from './fixtures/build-frame.js';

/**
 * Encrypt an inflated frame the SAME way `aesCbcDecrypt` will undo it:
 *   - key  = sha256(rawKey).digest('hex').slice(0, 32) interpreted as utf8 (32 bytes)
 *   - iv   = utf8 bytes of `iv` (must be 16 bytes)
 *   - AES-256-CBC, auto-padding OFF → caller must zero-pad to a 16-byte boundary.
 * Returns url-safe base64 of the ciphertext (the envelope's pre-comma payload).
 */
function buildAesEnvelope(inflated: Buffer, rawKey: string, iv: string): string {
  const deflated = zlib.deflateSync(inflated);
  const pad = (16 - (deflated.length % 16)) % 16;
  const padded = Buffer.concat([deflated, Buffer.alloc(pad)]);
  const keyBytes = Buffer.from(
    createHash('sha256').update(rawKey).digest('hex').slice(0, 32),
    'utf8',
  );
  const ivBytes = Buffer.from(iv, 'utf8');
  const cipher = createCipheriv('aes-256-cbc', keyBytes, ivBytes);
  cipher.setAutoPadding(false);
  const enc = Buffer.concat([cipher.update(padded), cipher.final()]);
  return enc.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

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

  it('round-trips an AES-256-CBC + zlib frame via opts.{key,iv}', () => {
    const rawKey = 'per-blob-secret-key';
    const iv = '0123456789abcdef'; // 16 ASCII bytes
    const envelope = buildAesEnvelope(frame.inflated, rawKey, iv);
    const out = unwrapEnvelope(envelope, { key: rawKey, iv });
    expect(out.equals(frame.inflated)).toBe(true);
  });

  it('round-trips an AES frame via the comma-embedded key (iv from opts)', () => {
    const rawKey = 'embedded-comma-key';
    const iv = 'fedcba9876543210'; // 16 ASCII bytes
    const envelope = buildAesEnvelope(frame.inflated, rawKey, iv);
    // The wire convention appends the per-blob key after a comma; the embedded
    // key wins over opts.key, but the IV still comes from opts.
    const out = unwrapEnvelope(`${envelope},${rawKey}`, { key: 'ignored', iv });
    expect(out.equals(frame.inflated)).toBe(true);
  });

  it('rejects an IV that is not 16 bytes', () => {
    const rawKey = 'k';
    const envelope = buildAesEnvelope(frame.inflated, rawKey, '0123456789abcdef');
    expect(() => unwrapEnvelope(envelope, { key: rawKey, iv: 'short' })).toThrow(/16 ASCII bytes/);
  });

  // A plain (no-AES) url-safe-base64(zlib(x)) envelope — the single-wrap form.
  const plainEnvelope = (x: Buffer): string =>
    zlib.deflateSync(x).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

  describe('double-wrapped frames (some firmwares wrap live-clean frames twice)', () => {
    it('peels an extra base64→zlib layer until the binary frame surfaces', () => {
      const inner = plainEnvelope(frame.inflated); // url-safe-base64 of zlib(frame)
      const doubleWrapped = plainEnvelope(Buffer.from(inner, 'latin1'));
      const out = unwrapEnvelope(doubleWrapped);
      expect(out.equals(frame.inflated)).toBe(true);
    });

    it('still single-unwraps a normal frame (no false peel of binary)', () => {
      const out = unwrapEnvelope(plainEnvelope(frame.inflated));
      expect(out.equals(frame.inflated)).toBe(true);
    });

    it('looksLikeBase64Zlib: true for a base64-zlib text buffer, false for a binary frame', () => {
      const textLayer = Buffer.from(plainEnvelope(frame.inflated), 'latin1');
      expect(looksLikeBase64Zlib(textLayer)).toBe(true);
      // The inflated binary frame has non-base64 bytes (int16 header / 0x00 pad).
      expect(looksLikeBase64Zlib(frame.inflated)).toBe(false);
    });
  });
});
