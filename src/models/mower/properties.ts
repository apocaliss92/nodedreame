/**
 * Mower MIoT property / action / event identifiers and the embedded
 * scheduling-task opcode payloads, reverse-engineered from
 * antondaubert/dreame-mower (const.py + device.py _build_*_task_payload).
 * Only KNOWN/useful ids are ported; the donor's unnamed SERVICE2_PROPERTY_* /
 * SERVICE5_PROPERTY_* are intentionally omitted.
 *
 * Encoding note: the four siid-5 actions (START_MOWING/STOP/DOCK/PAUSE) take NO
 * in-params. Targeted starts + resume are sent as ACTIONS on SCHEDULING_TASK
 * (siid 2 piid 50) whose in-params are `[ <opcodeObject> ]` — a one-element
 * array carrying the raw {m,p,o,d?} object (NOT the vacuum's {piid,value} form).
 */

/** Mower service properties (subset; unnamed reverse-engineered props skipped). */
export const MOWER_PROP = {
  /** VERIFIED-by-donor — 20-byte heartbeat (sentinel 0xCE at [0]/[19]); byte 11
   *  battery, byte 12 main-state, byte 13 task sub-state. See parseHeartbeat. */
  HEARTBEAT: { siid: 1, piid: 1 } as const,
  /** VERIFIED-by-donor — pose + coverage telemetry (binary). P4 uses progress % only. */
  POSE_COVERAGE: { siid: 1, piid: 4 } as const,
  /** VERIFIED-by-donor — MowerStatus (DeviceStatus). */
  STATUS: { siid: 2, piid: 1 } as const,
  /** VERIFIED-by-donor — device code blob (model/region). Not decoded in P4. */
  DEVICE_CODE: { siid: 2, piid: 2 } as const,
  /** VERIFIED-by-donor — mission task descriptor object {t,d:{...}}; also the action target. */
  SCHEDULING_TASK: { siid: 2, piid: 50 } as const,
  /** VERIFIED-by-donor — mission completion summary (often empty). */
  SCHEDULING_SUMMARY: { siid: 2, piid: 52 } as const,
  /** VERIFIED-by-donor — per-zone control status {status:[[zone,code],...]}. */
  MOWER_CONTROL_STATUS: { siid: 2, piid: 56 } as const,
  /** VERIFIED-by-donor — battery percentage 0-100. */
  BATTERY: { siid: 3, piid: 1 } as const,
  /** VERIFIED-by-donor — MowerChargingStatus. */
  CHARGING_STATUS: { siid: 3, piid: 2 } as const,
  /** VERIFIED-by-donor — task status code (MowerTaskStatus; mostly diagnostic). */
  TASK_STATUS: { siid: 5, piid: 104 } as const,
} as const;

/** Mower actions (siid 5). No in-params — parity with the donor execute_action. */
export const MOWER_ACTION = {
  START_MOWING: { siid: 5, aiid: 1 } as const,
  STOP: { siid: 5, aiid: 2 } as const,
  DOCK: { siid: 5, aiid: 3 } as const,
  PAUSE: { siid: 5, aiid: 4 } as const,
} as const;

/** Mower events. */
export const MOWER_EVENT = {
  /** VERIFIED-by-donor — mission completion (siid 4 eiid 1). */
  MISSION_COMPLETION: { siid: 4, eiid: 1 } as const,
} as const;

/**
 * Embedded scheduling-task opcodes carried in SCHEDULING_TASK (2:50) action
 * in-params. `m:'a'` = action, `p` = priority, `o` = opcode, `d` = data.
 * RESUME (o:5) is the donor's TASK_PAYLOAD_RESUME (continueControl).
 */
export const TASK_OPCODE = {
  RESUME: { m: 'a', p: 0, o: 5 } as const,
  ALL_AREA: 100,
  EDGE: 101,
  ZONE: 102,
  SPOT: 103,
  SET_CURRENT_MAP: 200,
} as const;

/** A fresh resume opcode object (never share the frozen literal across calls). */
export function buildResumePayload(): { m: string; p: number; o: number } {
  return { m: 'a', p: 0, o: 5 };
}

/** All-area start: o:100, region_id=[mapId], area_id=[]. device.py _build_all_area_task_payload. */
export function buildAllAreaPayload(mapId: number): {
  m: string;
  p: number;
  o: number;
  d: { region_id: number[]; area_id: number[] };
} {
  return { m: 'a', p: 0, o: TASK_OPCODE.ALL_AREA, d: { region_id: [mapId], area_id: [] } };
}

/** Zone start: o:102, region=zoneIds. device.py _build_zone_task_payload. */
export function buildZonePayload(zoneIds: number[]): {
  m: string;
  p: number;
  o: number;
  d: { region: number[] };
} {
  return { m: 'a', p: 0, o: TASK_OPCODE.ZONE, d: { region: [...zoneIds] } };
}

/** Edge start: o:101, edge=contourIdPairs. device.py _build_edge_task_payload. */
export function buildEdgePayload(contourIds: number[][]): {
  m: string;
  p: number;
  o: number;
  d: { edge: number[][] };
} {
  return { m: 'a', p: 0, o: TASK_OPCODE.EDGE, d: { edge: contourIds.map((c) => [...c]) } };
}

/** Spot start: o:103, area=spotAreaIds. device.py _build_spot_task_payload. */
export function buildSpotPayload(spotAreaIds: number[]): {
  m: string;
  p: number;
  o: number;
  d: { area: number[] };
} {
  return { m: 'a', p: 0, o: TASK_OPCODE.SPOT, d: { area: [...spotAreaIds] } };
}

/** Switch active map: o:200, idx=mapIndex. device.py _build_set_current_map_payload. */
export function buildSetCurrentMapPayload(mapIndex: number): {
  m: string;
  p: number;
  o: number;
  d: { idx: number };
} {
  return { m: 'a', p: 0, o: TASK_OPCODE.SET_CURRENT_MAP, d: { idx: mapIndex } };
}

/**
 * CMS consumable getter payload `{m:'g', t:'CMS'}` — read the blade/brush/robot
 * minute counters. Sent as the single in-param of the SCHEDULING_TASK (2:50)
 * action. device.py `_build_get_consumable_payload`.
 */
export function buildGetConsumablePayload(): { m: string; t: string } {
  return { m: 'g', t: 'CMS' };
}

/**
 * CMS consumable setter payload `{m:'s', t:'CMS', d:{value:[...]}}` — write the
 * three counters (used to reset one to 0). device.py
 * `_build_set_consumable_payload`. Throws on a non-3 / negative counter list.
 */
export function buildSetConsumablePayload(values: number[]): {
  m: string;
  t: string;
  d: { value: number[] };
} {
  const normalized = values.map((v) => Math.trunc(v));
  if (normalized.length !== 3) {
    throw new RangeError(`CMS values must contain exactly 3 counters; got ${normalized.length}`);
  }
  if (normalized.some((v) => v < 0)) {
    throw new RangeError(`CMS values cannot be negative; got ${JSON.stringify(normalized)}`);
  }
  return { m: 's', t: 'CMS', d: { value: normalized } };
}
