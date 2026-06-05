/**
 * JSON tail extraction from an inflated map frame buffer.
 *
 * The tail is UTF-8 JSON immediately after the header + pixel grid;
 * `MapTail` (`./types.ts`) describes the subset of keys we consume.
 *
 * `parseFrame` is the composed seam used by both `decodeVacuumMap`
 * and the rism-recurse path inside it — keeping the
 * "header → tail" sequence in one place ensures the two call sites
 * can't drift independently.
 */

import { HEADER_SIZE, MapDecodeError } from './envelope.js';
import { parseMapHeader, type MapHeader } from './header.js';
import type { MapTail } from './types.js';

export function sliceTailText(inflated: Buffer, header: MapHeader): string {
  const start = HEADER_SIZE + header.width * header.height;
  if (inflated.length < start) {
    throw new MapDecodeError(
      `tail: inflated payload shorter than header+pixels (${inflated.length} < ${start})`,
    );
  }
  return inflated.subarray(start).toString('utf8');
}

/**
 * Narrow a parsed JSON value to the loose `MapTail` shape without a
 * cast: `MapTail` is an all-optional interface with a
 * `[key: string]: unknown` index signature, so any plain non-null
 * object satisfies it once we've confirmed it is a record. A non-object
 * JSON top-level (number, string, array, null) is rejected.
 */
function asMapTail(value: unknown): MapTail {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MapDecodeError('tail: JSON top-level is not an object');
  }
  const record: Record<string, unknown> = { ...value };
  return record;
}

export function parseMapJsonTail(text: string): MapTail {
  if (!text) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new MapDecodeError('tail: JSON parse failed', { cause: err });
  }
  return asMapTail(parsed);
}

/**
 * Parse the header + JSON tail from an already-inflated frame buffer.
 *
 * Combines `parseMapHeader` + `sliceTailText` + `parseMapJsonTail`,
 * which the decoder, the rism-recurse path, and (deliberately not)
 * `merge.ts` invoke as a unit. Centralising the sequence keeps the
 * call sites in lockstep — the alternative is to drift independently
 * if one is updated without the others.
 *
 * Pure; doesn't unwrap base64 — call `unwrapEnvelope` first.
 */
export function parseFrame(inflated: Buffer): { header: MapHeader; tail: MapTail } {
  const header = parseMapHeader(inflated);
  const tail = parseMapJsonTail(sliceTailText(inflated, header));
  return { header, tail };
}
