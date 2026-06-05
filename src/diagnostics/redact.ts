/**
 * Deep, cast-free anonymization of a value tree before it enters a DeviceDump.
 * Dumps are shared PUBLICLY, so every identity/secret/PII field is replaced with
 * {@link REDACTED}. Matching is by FIELD NAME (case-insensitive, substring) so a
 * `customName`/`accessToken`/`refresh_token` is caught regardless of casing or
 * surrounding context. Non-sensitive data (model, firmware, region, the numeric
 * property keys + their values, enum names) passes through untouched.
 *
 * Immutable: returns NEW objects/arrays; never mutates the input.
 */

/** Placeholder substituted for any redacted value. */
export const REDACTED = '[redacted]';

/**
 * Lower-cased field-name fragments that mark a sensitive field. A key matches
 * when its lower-cased form CONTAINS one of these fragments. Ordered roughly by
 * spec §5 grouping (identity/secrets, then location/PII, then free-text names).
 */
const SENSITIVE_KEY_FRAGMENTS: readonly string[] = [
  // identity / secrets
  'did',
  'uid',
  'token', // accessToken, refreshToken, refresh_token, token_type stripped too (safe)
  'mac',
  'serial',
  'email',
  'account',
  'password',
  'passwd',
  'secret',
  'authorization',
  'auth',
  'credential',
  'apikey',
  'api_key',
  'clientid',
  'client_id',
  // location / PII
  'gps',
  'coordinate',
  'latitude',
  'longitude',
  'lat',
  'lon',
  'lng',
  'ssid',
  'wifi',
  'bssid',
  'ipaddr',
  'localip',
  'binddomain',
  'host',
  'address',
  'room',
  'area_name',
  'areaname',
  'segmentname',
  'segment_name',
  // map binary / geometry (location-revealing)
  'map_info',
  'mapinfo',
  'mapblob',
  // free-text device names that may carry PII. NOTE: the bare fragment `name` is
  // intentionally NOT listed — it would over-match the catalog's command `name`
  // field (an enum-derived, non-sensitive label). The specific custom-name
  // fields below cover every PII-bearing case.
  'customname',
  'devicename',
  'nickname',
];

/** Bare `ip` is matched exactly (substring-`ip` would over-match e.g. `equip`). */
const EXACT_SENSITIVE_KEYS: ReadonlySet<string> = new Set(['ip']);

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (EXACT_SENSITIVE_KEYS.has(lower)) {
    return true;
  }
  return SENSITIVE_KEY_FRAGMENTS.some((frag) => lower.includes(frag));
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Recursively scrub a value. Sensitive KEYS short-circuit to {@link REDACTED}. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => redact(v));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = isSensitiveKey(k) ? REDACTED : redact(v);
    }
    return out;
  }
  return value;
}
