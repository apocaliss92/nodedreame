/**
 * Mower MIoT enum value spaces, reverse-engineered from antondaubert/dreame-mower
 * (const.py DeviceStatus + STATUS_MAPPING + CHARGING_STATUS_MAPPING, and
 * property/mower_control.py + service5.py). The donor is a working HA
 * integration, so these are VERIFIED-by-donor; members annotated ASSUMED are
 * not yet corroborated. The integer is always the source of truth.
 */

/** VERIFIED-by-donor — STATUS_PROPERTY (siid 2 piid 1), const.py DeviceStatus. */
export enum MowerStatus {
  NoStatus = 0,
  Mowing = 1,
  Standby = 2,
  Paused = 3,
  PausedDueToErrors = 4,
  ReturningToCharge = 5,
  Charging = 6,
  Mapping = 11,
  ChargingComplete = 13,
  Updating = 14,
}

/** VERIFIED-by-donor — CHARGING_STATUS_PROPERTY (siid 3 piid 2), CHARGING_STATUS_MAPPING. */
export enum MowerChargingStatus {
  NotDocked = 0,
  Charging = 1,
  NotCharging = 2,
  ChargingCompleted = 3,
  ReturnToCharge = 5,
  /** Charging paused: battery temperature too low (donor issue #40). */
  ChargingPausedLowTemperature = 16,
}

/**
 * VERIFIED-by-donor — per-zone control code in MOWER_CONTROL_STATUS (siid 2
 * piid 56) `status` array entries `[zone_id, code]`. mower_control.py.
 */
export enum MowerControlAction {
  /** Zone waiting in a multi-zone session. */
  Queued = -1,
  /** Actively mowing. */
  Continue = 0,
  Completed = 2,
  Pause = 4,
}

/**
 * Observed TASK_STATUS codes (siid 5 piid 104), service5.py TASK_STATUS_MAPPING.
 * Only `SpotIncomplete` (7) has a confirmed meaning; the others in the donor are
 * "Unknown task status: N" — ASSUMED / not exposed as named members here.
 */
export enum MowerTaskStatus {
  /** "Task incomplete - spot mowing". */
  SpotIncomplete = 7,
}
