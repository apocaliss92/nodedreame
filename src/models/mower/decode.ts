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
    const zone = pair[0];
    const code = pair[1];
    if (zone === undefined || code === undefined) {
      return null;
    }
    zones.push([zone, code]);
  }
  const primary = zones.find((e) => e[1] === 0) ?? zones[0];
  const code = primary?.[1] ?? null;
  return {
    action: code === null ? null : controlActionFor(code),
    statusCode: code,
    zones,
  };
}
