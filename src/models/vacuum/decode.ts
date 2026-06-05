/**
 * Cast-free decode helpers for vacuum state (ported from node-dreame
 * src/vacuum/state.ts, MIT). The donor's `asEnum` used `num as T`; this
 * port replaces it with a numeric-membership check so callers can narrow
 * with no banned cast.
 */

/** Coerce a raw MIoT value to a number, or null. */
export function asNum(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

/** Numeric members of a TS numeric enum object (ascending insertion order). */
export function enumMembers(enumObj: Record<string, unknown>): number[] {
  return Object.values(enumObj).filter((v): v is number => typeof v === 'number');
}

/**
 * Parse the multi-value FAULTS_STR (siid 4 piid 18) into an array of fault
 * ints. Comma-separated when multiple conditions are latched; the single
 * case is the int as a string. Empty / "0" / whitespace → []. A bare
 * non-zero number is accepted as a one-element list.
 */
export function parseFaultList(value: unknown): number[] {
  if (typeof value !== 'string') {
    if (typeof value === 'number' && value !== 0) {
      return [value];
    }
    return [];
  }
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '0') {
    return [];
  }
  const codes: number[] = [];
  for (const part of trimmed.split(',')) {
    const n = Number.parseInt(part.trim(), 10);
    if (Number.isFinite(n) && n !== 0) {
      codes.push(n);
    }
  }
  return codes;
}
