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
  // `deviceid` is listed explicitly: the bare `did` fragment does NOT match
  // `deviceid` (the substring `did` is absent from `d-e-v-i-c-e-i-d`), yet
  // base-device sets the real `did` as `deviceId` on raw payloads (FIX 1).
  'deviceid',
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
  // room/zone/map names are user-set PII (FIX 3).
  'zone_name',
  'zonename',
  'map_name',
  'mapname',
  // map binary / geometry (location-revealing)
  'map_info',
  'mapinfo',
  'mapblob',
  // free-text device names that may carry PII. NOTE: the bare fragment `name` is
  // intentionally NOT listed — it would over-match the catalog's command `name`
  // field (an enum-derived, non-sensitive label like `START`). ACCEPTED
  // TRADE-OFF: a bare `{ name: "..." }` in an event argument is NOT scrubbed by
  // key. This is mitigated in practice by (a) the value-sanitizer below
  // (sanitizeStringValue, applied to EVERY string scalar — it catches OSS
  // paths / URLs / tokens regardless of key), and (b) the specific
  // customName/deviceName/nickName/zoneName/mapName fragments which cover the
  // realistic PII-bearing name cases.
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

/**
 * Risky-VALUE patterns. A string scalar can carry a secret under a NON-sensitive
 * (e.g. numeric `"siid.piid"`) key — an OSS object path `ali_dreame/<uid>/<did>/<n>`,
 * a signed URL with a `token=` query param, or a long opaque secret run. These
 * never reach a key-name match, so they slip past {@link isSensitiveKey}.
 *
 * Kept DELIBERATELY conservative so the actual diagnostic signal (enum names like
 * `START`/`SweepAndMop`, numeric-ish strings, comma fault lists like `"18,107"`,
 * small JSON) is preserved. Only the patterns below trigger a redact.
 */
const RISKY_VALUE_PATTERNS: readonly RegExp[] = [
  /:\/\//, // any URL scheme (https://, mqtts://, …) — signed URLs carry tokens
  /ali_dreame\//i, // OSS object path embedding uid/did
  /[A-Za-z0-9_-]{32,}/, // a long opaque token run (base64/hex secrets)
  /\b(did|uid|token)\s*=/i, // query-param secrets (?did=…&token=…)
  /access/i, // accessKey / access-token / x-access-key style markers
];

/**
 * Replace a string VALUE with {@link REDACTED} when it matches a risky pattern,
 * otherwise return it unchanged. Applied to EVERY string scalar inside
 * {@link redact}, so it covers property values, event arguments, AND raw frames.
 */
export function sanitizeStringValue(s: string): string {
  return RISKY_VALUE_PATTERNS.some((re) => re.test(s)) ? REDACTED : s;
}

/**
 * Recursively scrub a value. Sensitive KEYS short-circuit to {@link REDACTED};
 * every surviving string scalar is additionally passed through
 * {@link sanitizeStringValue} (value-level secret detection).
 */
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
  if (typeof value === 'string') {
    return sanitizeStringValue(value);
  }
  return value;
}
