/**
 * Dreame room SEGMENT-TYPE → display-name table. A robot segment carries a
 * `type` code in its `seg_inf` record; the Dreamehome app (and the HA
 * `dreame_vacuum` integration) render a localized DEFAULT name from that code
 * when the user has NOT assigned a custom name. A custom-named room is stored
 * with `type === 0` plus a base64 `name`. Ported verbatim from the donor
 * `dreame/types.py SEGMENT_TYPE_CODE_TO_NAME`.
 */
export const SEGMENT_TYPE_CODE_TO_NAME: Readonly<Record<number, string>> = {
  0: 'Room',
  1: 'Living Room',
  2: 'Primary Bedroom',
  3: 'Study',
  4: 'Kitchen',
  5: 'Dining Hall',
  6: 'Bathroom',
  7: 'Balcony',
  8: 'Corridor',
  9: 'Utility Room',
  10: 'Closet',
  11: 'Meeting Room',
  12: 'Office',
  13: 'Fitness Area',
  14: 'Recreation Area',
  15: 'Secondary Bedroom',
};

/** Decode a base64 segment name to UTF-8, or `null` on malformed input. */
function safeBase64ToUtf8(s: string): string | null {
  try {
    return Buffer.from(s, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Resolve a segment's display name, mirroring the donor `Segment.set_name`:
 *  1. a known room `type` (≠ 0) wins → its localized default name, suffixed
 *     `" {index+1}"` for the 2nd+ room of the same type (e.g. `Bedroom 2`);
 *  2. otherwise a user-assigned base64 `customName` (stored with `type === 0`);
 *  3. otherwise `null` (the caller renders a `Room <id>` fallback).
 *
 * @param type        `seg_inf.<id>.type` room-category code (0 = custom/none).
 * @param index       `seg_inf.<id>.index` ordinal among same-type rooms.
 * @param customName  `seg_inf.<id>.name` — base64-encoded user name, if any.
 */
export function resolveSegmentName(
  type: number | undefined,
  index: number | undefined,
  customName: string | undefined,
): string | null {
  if (type !== undefined && type !== 0 && SEGMENT_TYPE_CODE_TO_NAME[type] !== undefined) {
    const base = SEGMENT_TYPE_CODE_TO_NAME[type];
    return index !== undefined && index > 0 ? `${base} ${index + 1}` : base;
  }
  if (typeof customName === 'string' && customName.length > 0) {
    return safeBase64ToUtf8(customName);
  }
  return null;
}
