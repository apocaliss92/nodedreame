/**
 * Cast-free decode primitives shared by the vacuum and mower model layers.
 * `enumLookup` was a private helper in vacuum-device.ts (P3); promoted here so
 * the mower reuses it verbatim with no banned cast. The narrower relies on
 * `members.find(...)` being `E | undefined`, so no `as` is needed to turn a raw
 * number back into an enum literal.
 */

/** Coerce a raw MIoT value to a number, or null. */
export function asNum(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

/**
 * Returns a narrower: a raw number (or null) maps to the matching ENUM-typed
 * member, or null when not a member. Cast-free.
 */
export function enumLookup<E extends number>(
  members: readonly E[],
): (n: number | null) => E | null {
  const set = new Set<number>(members);
  return (n) => (n !== null && set.has(n) ? (members.find((m) => m === n) ?? null) : null);
}
