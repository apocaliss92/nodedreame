/**
 * AI obstacle-detection codec. The robot packs ALL AI-obstacle toggles into a
 * SINGLE MIoT property — `AI_DETECTION` (siid 4 piid 22) — whose value is EITHER
 * an `int` bitmask OR a `str` JSON object, depending on firmware generation.
 * Ported from the Tasshack `dreame-vacuum` HA integration (v2.0.0b25):
 *   - INT  ←→ `DreameVacuumAIProperty`     (bitwise flags)
 *   - JSON ←→ `DreameVacuumStrAIProperty`  ({ "<key>": bool })
 *
 * This module exposes per-feature decode + a read-modify-write encode that
 * preserves the other features, so a consumer can present each AI toggle as an
 * independent boolean without knowing which on-wire encoding the model uses.
 */

/** Canonical AI-obstacle feature keys. A given model exposes a subset. */
export type DreameAiFeature =
  | 'furnitureDetection'
  | 'obstacleDetection'
  | 'obstaclePicture'
  | 'fluidDetection'
  | 'petDetection'
  | 'obstacleImageUpload'
  | 'petAvoidance'
  | 'fuzzyObstacleDetection'
  | 'petPicture'
  | 'petFocusedDetection'
  | 'largeParticlesBoost'
  | 'humanDetection';

/**
 * Bit value in the INT-encoded `AI_DETECTION` (Tasshack `DreameVacuumAIProperty`).
 * A feature absent here has no int representation (JSON-only).
 */
export const AI_FEATURE_BIT: Readonly<Partial<Record<DreameAiFeature, number>>> = {
  furnitureDetection: 1,
  obstacleDetection: 2,
  obstaclePicture: 4,
  fluidDetection: 8,
  petDetection: 16,
  obstacleImageUpload: 32,
  // AI_IMAGE = 64 is an internal flag, not a user toggle — intentionally omitted.
  petAvoidance: 128,
  fuzzyObstacleDetection: 256,
  petPicture: 512,
  petFocusedDetection: 1024,
  largeParticlesBoost: 2048,
};

/**
 * Key in the JSON-string-encoded `AI_DETECTION` (Tasshack
 * `DreameVacuumStrAIProperty`). A feature absent here has no JSON representation.
 */
export const AI_FEATURE_JSON_KEY: Readonly<Partial<Record<DreameAiFeature, string>>> = {
  obstacleDetection: 'obstacle_detect_switch',
  obstacleImageUpload: 'obstacle_app_display_switch',
  petDetection: 'whether_have_pet',
  humanDetection: 'human_detect_switch',
  furnitureDetection: 'furniture_detect_switch',
  fluidDetection: 'fluid_detect_switch',
};

/** The raw on-wire `AI_DETECTION` value: an int bitmask, a JSON string, or absent. */
export type AiDetectionRaw = number | string | null;

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Parse a JSON-string AI payload into an object, or null when not an object. */
function parseJsonPayload(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Coerce a JSON value (bool | 1/0 | "1"/"0") to a boolean, or null when ambiguous. */
function coerceBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === '1') return true;
  if (v === 0 || v === '0') return false;
  return null;
}

/**
 * Decode ONE AI feature's on/off state from the raw `AI_DETECTION` value,
 * transparently handling both the int-bitmask and JSON-string encodings.
 * Returns `null` when the value is absent, the encoding cannot represent the
 * feature, or the JSON payload omits the key.
 */
export function decodeAiFeature(raw: AiDetectionRaw, feature: DreameAiFeature): boolean | null {
  if (typeof raw === 'number') {
    const bit = AI_FEATURE_BIT[feature];
    if (bit === undefined) return null;
    return (raw & bit) === bit;
  }
  if (typeof raw === 'string') {
    const key = AI_FEATURE_JSON_KEY[feature];
    if (key === undefined) return null;
    const payload = parseJsonPayload(raw);
    if (payload === null) return null;
    return coerceBool(payload[key]);
  }
  return null;
}

/**
 * Compute the value to WRITE back to `AI_DETECTION` after toggling ONE feature,
 * preserving the on-wire encoding and the other features. Mirrors Tasshack
 * `set_ai_detection`: an int payload is the full new bitmask; a JSON payload
 * carries ONLY the changed key (the device merges it server-side).
 *
 * Throws when the current value/encoding is unknown (a blind read-modify-write
 * could clobber the other features) or the feature has no representation in the
 * active encoding.
 */
export function encodeAiFeatureWrite(
  raw: AiDetectionRaw,
  feature: DreameAiFeature,
  value: boolean,
): number | string {
  if (typeof raw === 'number') {
    const bit = AI_FEATURE_BIT[feature];
    if (bit === undefined) {
      throw new Error(`encodeAiFeatureWrite: feature "${feature}" has no int-bitmask representation`);
    }
    return value ? raw | bit : raw & ~bit;
  }
  if (typeof raw === 'string') {
    const key = AI_FEATURE_JSON_KEY[feature];
    if (key === undefined) {
      throw new Error(`encodeAiFeatureWrite: feature "${feature}" has no JSON-key representation`);
    }
    return JSON.stringify({ [key]: value });
  }
  throw new Error(
    `encodeAiFeatureWrite: AI_DETECTION value not yet known — cannot safely toggle "${feature}"`,
  );
}
