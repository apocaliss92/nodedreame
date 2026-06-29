/**
 * Auto-switch settings codec. The robot packs a large bundle of secondary
 * cleaning toggles + multi-value settings into a SINGLE MIoT property —
 * `AUTO_SWITCH_SETTINGS` (siid 4 piid 50) — whose value is a JSON string.
 * Ported from the Tasshack `dreame-vacuum` HA integration (v2.0.0b25,
 * `DreameVacuumAutoSwitchProperty` + `set_auto_switch_property`):
 *
 *   - READ  : a JSON LIST `[{"k":"LessColl","v":1}, …]` (or a single
 *             `{"k":…,"v":…}` object) — every supported key/value pair.
 *   - WRITE : a SINGLE `{"k":"LessColl","v":0}` object carrying ONLY the
 *             changed key; the device merges it server-side.
 *
 * Unlike `AI_DETECTION` this family is JSON-ONLY (no int-bitmask variant) and the
 * values are arbitrary ints (booleans 0/1, small enums, and `-1`/`-n` "not
 * applicable" sentinels) — the codec returns the raw int and leaves the
 * boolean-vs-enum interpretation to the caller. Presence is data-driven: a key is
 * "supported" iff it appears in the decoded payload (exactly how Tasshack derives
 * `auto_switch_data`).
 */

/** Canonical auto-switch keys. A given model reports a subset. */
export type AutoSwitchKey =
  | 'collisionAvoidance'
  | 'fillLight'
  | 'autoDrying'
  | 'stainAvoidance'
  | 'moppingType'
  | 'cleanGenius'
  | 'widerCornerCoverage'
  | 'floorDirectionCleaning'
  | 'petFocusedCleaning'
  | 'autoRecleaning'
  | 'autoRewashing'
  | 'mopPadSwing'
  | 'autoCharging'
  | 'humanFollow'
  | 'maxSuctionPower'
  | 'smartDrying'
  | 'drainageConfirmResult'
  | 'drainageTestResult'
  | 'hotWashing'
  | 'uvSterilization'
  | 'cleaningRoute'
  | 'customMoppingMode'
  | 'moppingMode'
  | 'selfCleanFrequency'
  | 'intensiveCarpetCleaning'
  | 'gapCleaningExtension'
  | 'moppingUnderFurnitures'
  | 'ultraCleanMode'
  | 'streamingVoicePrompt'
  | 'mopExtend'
  | 'mopExtendFrequency'
  | 'sideReach'
  | 'intelligentStainCleaning';

/**
 * Short on-wire key for each setting inside the `AUTO_SWITCH_SETTINGS` JSON
 * (Tasshack `DreameVacuumAutoSwitchProperty`). These opaque strings are the
 * device's own identifiers and must match byte-for-byte.
 */
export const AUTO_SWITCH_JSON_KEY: Readonly<Record<AutoSwitchKey, string>> = {
  collisionAvoidance: 'LessColl',
  fillLight: 'FillinLight',
  autoDrying: 'AutoDry',
  stainAvoidance: 'StainIdentify',
  moppingType: 'CleanType',
  cleanGenius: 'SmartHost',
  widerCornerCoverage: 'MeticulousTwist',
  floorDirectionCleaning: 'MaterialDirectionClean',
  petFocusedCleaning: 'PetPartClean',
  autoRecleaning: 'SmartAutoMop',
  autoRewashing: 'SmartAutoWash',
  mopPadSwing: 'MopScalable',
  autoCharging: 'SmartCharge',
  humanFollow: 'MonitorHumanFollow',
  maxSuctionPower: 'SuctionMax',
  smartDrying: 'SmartDrying',
  drainageConfirmResult: 'FluctuationConfirmResult',
  drainageTestResult: 'FluctuationTestResult',
  hotWashing: 'HotWash',
  uvSterilization: 'UVLight',
  cleaningRoute: 'CleanRoute',
  customMoppingMode: 'MopEffectSwitch',
  moppingMode: 'MopEffectState',
  selfCleanFrequency: 'BackWashType',
  intensiveCarpetCleaning: 'CarpetFineClean',
  gapCleaningExtension: 'LacuneMopScalable',
  moppingUnderFurnitures: 'MopScalable2',
  ultraCleanMode: 'SuperWash',
  streamingVoicePrompt: 'MonitorPromptLevel',
  mopExtend: 'MopExtrSwitch',
  mopExtendFrequency: 'ExtrFreq',
  sideReach: 'SbrushExtrSwitch',
  intelligentStainCleaning: 'HeavyStainSmart',
};

/** Reverse map: on-wire key → canonical key (built once). */
const JSON_KEY_TO_CANONICAL: Readonly<Record<string, AutoSwitchKey>> = Object.fromEntries(
  (Object.entries(AUTO_SWITCH_JSON_KEY) as [AutoSwitchKey, string][]).map(([k, v]) => [v, k]),
);

/** The raw on-wire `AUTO_SWITCH_SETTINGS` value: a JSON string, or absent. */
export type AutoSwitchRaw = string | null;

/** Coerce a JSON value (number | numeric string) to a finite int, or null. */
function coerceInt(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Parse the raw `AUTO_SWITCH_SETTINGS` value into a `{ on-wire key → int }` map.
 * Accepts the list form (`[{"k":…,"v":…}, …]`) and the single-object form
 * (`{"k":…,"v":…}`). Returns null when the value is absent or unparseable.
 */
function parseAutoSwitchMap(raw: AutoSwitchRaw): Map<string, number> | null {
  if (typeof raw !== 'string' || raw.length <= 2) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const out = new Map<string, number>();
  const add = (entry: unknown): void => {
    if (entry === null || typeof entry !== 'object') return;
    const rec = entry as Record<string, unknown>;
    if (typeof rec['k'] !== 'string') return;
    const value = coerceInt(rec['v']);
    if (value !== null) out.set(rec['k'], value);
  };
  if (Array.isArray(parsed)) {
    for (const entry of parsed) add(entry);
  } else {
    add(parsed);
  }
  return out.size > 0 ? out : null;
}

/**
 * Decode ONE auto-switch setting's int value from the packed
 * `AUTO_SWITCH_SETTINGS` payload. Returns `null` when the value is absent or the
 * key is not present in the payload (i.e. unsupported by this model/firmware).
 */
export function decodeAutoSwitch(raw: AutoSwitchRaw, key: AutoSwitchKey): number | null {
  const map = parseAutoSwitchMap(raw);
  if (map === null) return null;
  const jsonKey = AUTO_SWITCH_JSON_KEY[key];
  return map.has(jsonKey) ? (map.get(jsonKey) ?? null) : null;
}

/**
 * The auto-switch keys the payload actually reports (presence-driven — mirrors
 * Tasshack `auto_switch_data`). On-wire keys with no canonical mapping (newer
 * firmware extras like `MopFullyScalable`) are skipped. Order follows
 * {@link AUTO_SWITCH_JSON_KEY} for determinism.
 */
export function supportedAutoSwitchKeys(raw: AutoSwitchRaw): readonly AutoSwitchKey[] {
  const map = parseAutoSwitchMap(raw);
  if (map === null) return [];
  const present: AutoSwitchKey[] = [];
  for (const key of Object.keys(AUTO_SWITCH_JSON_KEY) as AutoSwitchKey[]) {
    if (map.has(AUTO_SWITCH_JSON_KEY[key])) present.push(key);
  }
  return present;
}

/** All `{ canonical key → int }` pairs the payload reports (canonical keys only). */
export function decodeAutoSwitchAll(raw: AutoSwitchRaw): Readonly<Partial<Record<AutoSwitchKey, number>>> {
  const map = parseAutoSwitchMap(raw);
  if (map === null) return {};
  const out: Partial<Record<AutoSwitchKey, number>> = {};
  for (const [jsonKey, value] of map) {
    const canonical = JSON_KEY_TO_CANONICAL[jsonKey];
    if (canonical !== undefined) out[canonical] = value;
  }
  return out;
}

/**
 * Compute the value to WRITE to `AUTO_SWITCH_SETTINGS` for ONE setting. Mirrors
 * Tasshack `set_auto_switch_property`: a SINGLE `{"k":<key>,"v":<int>}` object
 * (NOT the full list) — the device merges it server-side, so the other settings
 * are preserved without a read-modify-write.
 */
export function encodeAutoSwitchWrite(key: AutoSwitchKey, value: number): string {
  return JSON.stringify({ k: AUTO_SWITCH_JSON_KEY[key], v: Math.trunc(value) });
}
