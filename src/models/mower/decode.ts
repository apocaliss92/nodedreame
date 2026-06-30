/**
 * Cast-free mower decoders. Re-exports the shared numeric primitives, and adds
 * the two structured-payload parsers the typed getters consume:
 *   - parseTaskDescriptor : SCHEDULING_TASK (2:50) {t,d:{...}} -> typed task
 *   - parseControlStatus  : MOWER_CONTROL_STATUS (2:56) {status:[[zone,code]]}
 * Ported from antondaubert/dreame-mower property/{scheduling,mower_control}.py.
 * The binary pose-track geometry (1:4) is OUT OF SCOPE here (P5).
 */
import { MowerControlAction } from './enums.js';
import { enumLookup } from '../_shared/decode.js';

export { asNum, enumLookup } from '../_shared/decode.js';

/** Typed scheduling task descriptor (subset of the donor TaskHandler fields). */
export interface MowerTaskDescriptor {
  taskType: string;
  executionActive: boolean;
  /** `d.o` — coverage target % or mode sentinel. */
  coverageTarget: number;
  taskActive: boolean;
  areaId: number[] | null;
  regionId: number[] | null;
  elapsedTime: number | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function numArrayOrNull(v: unknown): number[] | null {
  if (!Array.isArray(v)) {
    return null;
  }
  const out: number[] = [];
  for (const n of v) {
    if (typeof n !== 'number') {
      return null;
    }
    out.push(n);
  }
  return out;
}

/**
 * Parse the SCHEDULING_TASK descriptor (2:50). Required fields `d.exe`,
 * `d.o`, `d.status` must be present (matching the donor's KeyError-bubble);
 * optional area_id/region_id/time default to null. Returns null on any
 * malformed input — no throw, no cast.
 */
export function parseTaskDescriptor(value: unknown): MowerTaskDescriptor | null {
  if (!isRecord(value)) {
    return null;
  }
  const t = value['t'];
  const d = value['d'];
  if (typeof t !== 'string' || !isRecord(d)) {
    return null;
  }
  const exe = d['exe'];
  const o = d['o'];
  const status = d['status'];
  if (typeof exe !== 'boolean' || typeof o !== 'number' || typeof status !== 'boolean') {
    return null;
  }
  return {
    taskType: t === 'TASK' ? 'TASK' : 'UNKNOWN',
    executionActive: exe,
    coverageTarget: o,
    taskActive: status,
    areaId: numArrayOrNull(d['area_id']),
    regionId: numArrayOrNull(d['region_id']),
    elapsedTime: typeof d['time'] === 'number' ? d['time'] : null,
  };
}

const controlLookup = enumLookup<MowerControlAction>([
  MowerControlAction.Queued,
  MowerControlAction.Continue,
  MowerControlAction.Completed,
  MowerControlAction.Pause,
]);

/** Map a raw 2:56 entry code to a MowerControlAction, or null. Cast-free. */
export function controlActionFor(code: number): MowerControlAction | null {
  return controlLookup(code);
}

/** Typed mower control status (2:56). */
export interface MowerControlState {
  action: MowerControlAction | null;
  statusCode: number | null;
  zones: number[][];
}

/**
 * Parse MOWER_CONTROL_STATUS (2:56). `status` is `[[zone_id, code], ...]`.
 * Primary action = the actively-mowing zone (code 0), else the first entry.
 * Empty array -> null action. Warn-and-tolerate: an UNKNOWN code does NOT drop
 * the whole structure — the zone is surfaced as-is and its `action` resolves to
 * null (only the primary's action goes null when the primary itself is unknown).
 * Still returns null on a malformed PAIR shape (non-array / <2 / non-numeric).
 * No cast.
 */
export function parseControlStatus(value: unknown): MowerControlState | null {
  if (!isRecord(value)) {
    return null;
  }
  const status = value['status'];
  if (!Array.isArray(status)) {
    return null;
  }
  if (status.length === 0) {
    return { action: null, statusCode: null, zones: [] };
  }
  const zones: number[][] = [];
  for (const entry of status) {
    const pair = numArrayOrNull(entry);
    if (pair === null || pair.length < 2) {
      return null;
    }
    // `numArrayOrNull` already guarantees an all-number array and the length
    // check guarantees >=2 elements, so the pair is pushed as-is (no per-index
    // undefined guard needed — that branch would be unreachable / dead).
    zones.push(pair);
  }
  const primary = zones.find((e) => e[1] === 0) ?? zones[0];
  const code = primary?.[1] ?? null;
  return {
    action: code === null ? null : controlActionFor(code),
    statusCode: code,
    zones,
  };
}

// -- CMS consumables (custom action on SCHEDULING_TASK 2:50) -----------------

/** Canonical CMS consumable counter keys (blade, brush, robot maintenance). */
export type MowerConsumableKey = 'blade' | 'brush' | 'maintenance';

/** One CMS consumable counter: minutes used + total + remaining %. */
export interface MowerConsumableReading {
  readonly key: MowerConsumableKey;
  /** Minutes of run-time accrued on this counter (counts UP). */
  readonly usedMinutes: number;
  /** Counter's full-life duration in minutes. */
  readonly totalMinutes: number;
  /** Remaining life percentage (0..100, one decimal). */
  readonly remainingPercent: number;
}

/**
 * CMS counter layout, ported from antondaubert/dreame-mower `device.py`
 * (CONSUMABLE_COUNTER_TOTAL_MINUTES + CONSUMABLE_COUNTER_INDEX). The getter
 * returns `[blade_min, brush_min, robot_min]`; index/total are fixed per model.
 */
const MOWER_CONSUMABLES: ReadonlyArray<{
  readonly key: MowerConsumableKey;
  readonly index: number;
  readonly totalMinutes: number;
}> = [
  { key: 'blade', index: 0, totalMinutes: 6000 },
  { key: 'brush', index: 1, totalMinutes: 30000 },
  { key: 'maintenance', index: 2, totalMinutes: 3600 },
];

/** Map a consumable key (incl. aliases) to its CMS counter index. */
export function mowerConsumableIndex(item: string): number | null {
  switch (item.trim().toLowerCase()) {
    case 'blade':
    case 'blades':
      return 0;
    case 'brush':
    case 'cleaning_brush':
      return 1;
    case 'robot':
    case 'maintenance':
    case 'robot_maintenance':
      return 2;
    default:
      return null;
  }
}

function toInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return Math.trunc(v);
  }
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  return null;
}

/**
 * Pull the first successful data payload out of a custom-action result. Mirrors
 * the donor `_extract_custom_action_data`: the result itself when it carries a
 * `value` list, else its `d` object, else the first non-error `out[].d`.
 */
function extractCustomActionData(result: unknown): Record<string, unknown> | null {
  if (!isRecord(result)) {
    return null;
  }
  if (Array.isArray(result['value'])) {
    return result;
  }
  if (isRecord(result['d'])) {
    return result['d'];
  }
  const out = result['out'];
  if (!Array.isArray(out)) {
    return null;
  }
  for (const entry of out) {
    if (!isRecord(entry)) {
      continue;
    }
    const r = entry['r'];
    const code = entry['code'];
    const rError = r !== undefined && r !== null && r !== 0;
    const codeError = code !== undefined && code !== null && code !== 0;
    if (rError && codeError) {
      continue;
    }
    if (isRecord(entry['d'])) {
      return entry['d'];
    }
  }
  return null;
}

/**
 * Extract the raw `[blade, brush, robot]` minute counters from a CMS getter
 * result, or null if the response is malformed. Cast-free, no throw.
 */
export function extractMowerConsumableValues(result: unknown): number[] | null {
  const data = extractCustomActionData(result);
  if (data === null) {
    return null;
  }
  const values = data['value'];
  if (!Array.isArray(values) || values.length < 3) {
    return null;
  }
  const out: number[] = [];
  for (const v of values.slice(0, 3)) {
    const n = toInt(v);
    if (n === null) {
      return null;
    }
    out.push(n);
  }
  return out;
}

/**
 * Parse a CMS getter result into typed consumable readings (blade/brush/
 * maintenance) with remaining %. Returns null on a malformed response.
 */
export function parseMowerConsumables(result: unknown): readonly MowerConsumableReading[] | null {
  const values = extractMowerConsumableValues(result);
  if (values === null) {
    return null;
  }
  return MOWER_CONSUMABLES.map((c) => {
    const used = values[c.index] ?? 0;
    const remaining = c.totalMinutes - used;
    const pct = Math.max(0, Math.min(100, Math.round((remaining / c.totalMinutes) * 1000) / 10));
    return {
      key: c.key,
      usedMinutes: used,
      totalMinutes: c.totalMinutes,
      remainingPercent: pct,
    };
  });
}

// -- heartbeat task sub-state (HEARTBEAT 1:1) --------------------------------

/** Decoded mowing task sub-state (heartbeat byte 13), or null when no mowing
 *  session is in progress. Ported from antondaubert/dreame-mower
 *  `property_misc.py` Property11Handler. */
export type MowerTaskSubState =
  | 'idle'
  | 'starting'
  | 'mowing'
  | 'paused'
  | 'finished'
  | 'failed'
  | 'exit'
  | 'returning-to-dock';

/** Ordered sub-state table; the heartbeat encodes `subState = base + index`. */
export const MOWER_TASK_SUBSTATES: readonly MowerTaskSubState[] = [
  'idle',
  'starting',
  'mowing',
  'paused',
  'finished',
  'failed',
  'exit',
  'returning-to-dock',
];

const HEARTBEAT_SENTINEL = 0xce; // 206 — byte[0] and byte[last]
const HEARTBEAT_SUBSTATE_BASE = 33;
const HEARTBEAT_MAIN_STATE_MOWING = 4;

/** Typed heartbeat decode: battery byte, main-state, and (when mowing) the task
 *  sub-state. */
export interface MowerHeartbeat {
  /** Raw battery byte (byte 11) — percent with a charging flag in the high bits. */
  readonly rawBattery: number;
  /** `(byte12 & 0x0F) - 1`; 4 = mowing. */
  readonly mainState: number;
  /** Raw sub-state byte (byte 13). */
  readonly subStateRaw: number;
  /** Decoded sub-state when a mowing session is active, else null. */
  readonly taskSubState: MowerTaskSubState | null;
}

/**
 * Decode the 20-byte HEARTBEAT (1:1) blob. Returns null when the payload is not a
 * well-formed heartbeat (wrong length / missing 0xCE sentinels). The task
 * sub-state is only meaningful while `mainState === 4` (mowing); in any other
 * main state there is no active mowing task (returns `taskSubState: null`).
 */
export function parseMowerHeartbeat(value: unknown): MowerHeartbeat | null {
  if (!Array.isArray(value) || value.length < 14) {
    return null;
  }
  const bytes: number[] = [];
  for (const b of value) {
    if (typeof b !== 'number') {
      return null;
    }
    bytes.push(b);
  }
  if (bytes[0] !== HEARTBEAT_SENTINEL || bytes[bytes.length - 1] !== HEARTBEAT_SENTINEL) {
    return null;
  }
  const rawBattery = bytes[11] ?? 0;
  const mainState = ((bytes[12] ?? 0) & 0x0f) - 1;
  const subStateRaw = bytes[13] ?? 0;
  const taskSubState =
    mainState === HEARTBEAT_MAIN_STATE_MOWING
      ? (MOWER_TASK_SUBSTATES[subStateRaw - HEARTBEAT_SUBSTATE_BASE] ?? null)
      : null;
  return { rawBattery, mainState, subStateRaw, taskSubState };
}

// -- mowing progress (POSE_COVERAGE 1:4 task block) --------------------------

const POSE_SENTINEL = 0xce; // 206 — frames a sentinel-wrapped pose-coverage blob

/** Decoded mowing-progress signal from the POSE_COVERAGE (1:4) `task` block. */
export interface MowerMowingProgress {
  /** 0..100 — overall mowing completion. */
  readonly progressPercent: number;
  /** Already-finished area in m². */
  readonly currentAreaSqm: number;
  /** Total target area in m². */
  readonly totalAreaSqm: number;
}

/** Coerce a POSE_COVERAGE (1:4) raw value to a flat byte array, or null. */
function poseBytes(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const bytes: number[] = [];
  for (const b of value) {
    if (typeof b !== 'number') return null;
    bytes.push(b);
  }
  return bytes;
}

/**
 * Locate the 10-byte `task` block inside a POSE_COVERAGE (1:4) frame and decode
 * the mowing progress. Frame shapes (ported from antondaubert/dreame-mower
 * `pose_coverage.py`):
 *   - sentinel-framed `[CE] pose(6) trace(15) task(10) [CE]` (33B) / `…task(10) trace2(11) [CE]` (44B)
 *     → task at offset 22;
 *   - alt `task(10) [CE] [+trace]` (no leading sentinel, ≥11B) → task at offset 0.
 * The 22B `[CE] pose trace` and 13B `[CE] pose extra` shapes carry NO task → null.
 *
 * `task` layout: `[2:4] percent u16LE (value×100) [4:7] total u24LE (centi-m²)
 * [7:10] finished u24LE (centi-m²)`.
 */
export function parseMowingProgress(value: unknown): MowerMowingProgress | null {
  const bytes = poseBytes(value);
  if (bytes === null || bytes.length < 11) return null;
  const last = bytes[bytes.length - 1];
  const head = bytes[0];

  let offset: number | null = null;
  if (head !== POSE_SENTINEL && last === POSE_SENTINEL) {
    offset = 0; // alt format: task block leads
  } else if (head === POSE_SENTINEL && last === POSE_SENTINEL && bytes.length >= 33) {
    offset = 22; // standard sentinel-framed frame with a task block
  }
  if (offset === null || offset + 10 > bytes.length) return null;

  const rawPercent = (bytes[offset + 2] ?? 0) | ((bytes[offset + 3] ?? 0) << 8);
  const total =
    (bytes[offset + 4] ?? 0) | ((bytes[offset + 5] ?? 0) << 8) | ((bytes[offset + 6] ?? 0) << 16);
  const finish =
    (bytes[offset + 7] ?? 0) | ((bytes[offset + 8] ?? 0) << 8) | ((bytes[offset + 9] ?? 0) << 16);

  return {
    progressPercent: rawPercent ? Math.min(100, rawPercent / 100) : 0,
    currentAreaSqm: finish / 100,
    totalAreaSqm: total / 100,
  };
}
