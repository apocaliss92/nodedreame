/**
 * Outer-envelope handling for Dreame map blobs.
 *
 * Wire format: URL-safe base64 → optional AES-256-CBC decrypt → zlib
 * inflate → 27-byte binary header + width*height pixel grid + UTF-8
 * JSON tail. This module covers the first three steps; header / tail
 * parsing live in `header.ts` / `tail.ts`.
 */

import { createDecipheriv, createHash } from 'node:crypto';
import * as zlib from 'node:zlib';
import type { VacuumMapDecodeOptions } from './types.js';

/** Bytes 0-26 are the fixed-layout binary header. */
export const HEADER_SIZE = 27;

/** Sentinel value in `robot.a` / `charger.a` meaning "absent". */
export const ANGLE_ABSENT = 0x7fff;

/** Frame-type byte values from the header. */
export const FRAME_TYPE = {
  I: 73,
  P: 80,
  W: 87,
} as const;

export class MapDecodeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MapDecodeError';
  }
}

/**
 * Unwrap a raw MAP_DATA envelope value: URL-safe base64 → optional
 * AES-256-CBC decrypt → zlib inflate. The returned buffer starts with
 * the 27-byte header.
 *
 * If the value contains a comma, everything after the first comma is
 * treated as the per-blob AES key and AES is forced on (matching the
 * outer-envelope convention from Tasshack `map.py:3759-3792`). If `opts.key`
 * and `opts.iv` are also supplied, the embedded key wins.
 */
export function unwrapEnvelope(value: string, opts: VacuumMapDecodeOptions = {}): Buffer {
  const commaIdx = value.indexOf(',');
  const b64 = commaIdx >= 0 ? value.slice(0, commaIdx) : value;
  const embeddedKey = commaIdx >= 0 ? value.slice(commaIdx + 1) : null;

  const standard = b64.replace(/-/g, '+').replace(/_/g, '/');
  let bytes: Buffer;
  try {
    bytes = Buffer.from(standard, 'base64');
  } catch (err) {
    throw new MapDecodeError('envelope: base64 decode failed', { cause: err });
  }
  if (bytes.length === 0) {
    throw new MapDecodeError('envelope: empty payload after base64 decode');
  }

  const key = embeddedKey ?? opts.key ?? null;
  if (key) {
    if (!opts.iv) {
      throw new MapDecodeError(
        'envelope: AES key supplied but no IV — pass `opts.iv` (16-byte ASCII)',
      );
    }
    bytes = aesCbcDecrypt(bytes, key, opts.iv);
  }

  let inflated: Buffer;
  try {
    inflated = zlib.inflateSync(bytes);
  } catch (err) {
    throw new MapDecodeError('envelope: zlib inflate failed', { cause: err });
  }

  // Some models/firmwares DOUBLE-wrap live-clean frames: the first inflate yields
  // a URL-safe base64 STRING of ANOTHER zlib stream rather than the binary frame
  // (verified on dreame.vacuum.r2538z — head decodes to the `78 xx` zlib magic).
  // Peel extra base64→zlib layers until the payload is binary (bounded, so a
  // pathological input can't loop). A genuine binary frame is NOT entirely
  // base64-text (its int16 header fields + 0x00 padding fail the check), so the
  // single-wrap path is untouched.
  let guard = 0;
  while (guard < MAX_EXTRA_WRAP_LAYERS && looksLikeBase64Zlib(inflated)) {
    const text = inflated.toString('latin1').replace(/-/g, '+').replace(/_/g, '/');
    try {
      inflated = zlib.inflateSync(Buffer.from(text, 'base64'));
    } catch (err) {
      throw new MapDecodeError('envelope: nested zlib inflate failed', { cause: err });
    }
    guard += 1;
  }
  return inflated;
}

/** Upper bound on nested base64+zlib layers peeled by {@link unwrapEnvelope}. */
const MAX_EXTRA_WRAP_LAYERS = 4;

/**
 * Heuristic: does this buffer look like a base64-text wrapper around ANOTHER
 * zlib stream (rather than a binary map frame)? True only when the WHOLE buffer
 * is URL-safe-base64 characters AND a short prefix decodes to the zlib magic
 * byte `0x78`. A binary frame contains non-base64 bytes (header int16s / `0x00`
 * padding), so it never matches.
 */
export function looksLikeBase64Zlib(buf: Buffer): boolean {
  if (buf.length < 8) return false;
  for (const b of buf) {
    const isB64 =
      (b >= 0x41 && b <= 0x5a) || // A-Z
      (b >= 0x61 && b <= 0x7a) || // a-z
      (b >= 0x30 && b <= 0x39) || // 0-9
      b === 0x2b ||
      b === 0x2f || // + /
      b === 0x2d ||
      b === 0x5f || // - _ (url-safe)
      b === 0x3d; // =
    if (!isB64) return false;
  }
  try {
    const prefix = buf.subarray(0, 16).toString('latin1').replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(prefix, 'base64');
    return decoded.length >= 2 && decoded[0] === 0x78;
  } catch {
    return false;
  }
}

function aesCbcDecrypt(cipher: Buffer, rawKey: string, iv: string): Buffer {
  const keyBytes = Buffer.from(
    createHash('sha256').update(rawKey).digest('hex').slice(0, 32),
    'utf8',
  );
  const ivBytes = Buffer.from(iv, 'utf8');
  if (ivBytes.length !== 16) {
    throw new MapDecodeError(`envelope: AES IV must be 16 ASCII bytes, got ${ivBytes.length}`);
  }
  try {
    const decipher = createDecipheriv('aes-256-cbc', keyBytes, ivBytes);
    decipher.setAutoPadding(false);
    return Buffer.concat([decipher.update(cipher), decipher.final()]);
  } catch (err) {
    throw new MapDecodeError('envelope: AES decrypt failed', { cause: err });
  }
}
