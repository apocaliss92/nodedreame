/**
 * Vacuum MIoT property + action maps (ported from malard/node-dreame
 * src/spec/{vacuum,battery,settings,consumable}-props.ts, MIT — attribution
 * retained). P3 subset only (state/commands/consumables); map/dock/schedule
 * tables land in later phases. VERIFIED/ASSUMED annotations preserved.
 */

/** Vacuum service properties (siid 2 = state machine, siid 4 = task cluster). */
export const VACUUM_PROP = {
  /** VERIFIED r2532a — MiotState enum. */
  STATE: { siid: 2, piid: 1 } as const,
  /** VERIFIED r2532a — single-value error/fault code (see MiotError). */
  ERROR: { siid: 2, piid: 2 } as const,
  /** VERIFIED r2449a — writable CleaningMode (plain 0..3). SAFE write path. */
  CLEAN_MODE_SETTING: { siid: 2, piid: 6 } as const,
  /** VERIFIED r2532a — multi-value comma-separated fault-list mirror. */
  FAULTS_STR: { siid: 4, piid: 18 } as const,
  /** VERIFIED r2532a — Dreame "task status" enum (TaskStatus). */
  TASK_STATUS: { siid: 4, piid: 1 } as const,
  /** ASSUMED Tasshack types.py:573 — job runtime (minutes). */
  CLEANING_TIME: { siid: 4, piid: 2 } as const,
  /** ASSUMED Tasshack types.py:574 — area cleaned (m²). */
  CLEANED_AREA: { siid: 4, piid: 3 } as const,
  /** ASSUMED Tasshack types.py:575 — suction enum (SuctionLevel). */
  SUCTION_LEVEL: { siid: 4, piid: 4 } as const,
  /** ASSUMED Tasshack types.py:576 — water flow during cleaning (WaterVolume). */
  WATER_VOLUME: { siid: 4, piid: 5 } as const,
  /** ASSUMED Tasshack types.py:1479 — relocation state machine (0/1/10/11). */
  RELOCATION_STATUS: { siid: 4, piid: 20 } as const,
  /**
   * VERIFIED r2449a — packed (0x1400 capability mask | CleaningMode low-2-bits).
   * READ-ONLY here: do NOT write directly (drops mask → bricks next clean).
   * Use CLEAN_MODE_SETTING (siid 2 piid 6) to change clean mode.
   */
  CLEANING_MODE: { siid: 4, piid: 23 } as const,
  /** VERIFIED r2532a — Child Lock boolean. */
  CHILD_LOCK: { siid: 4, piid: 27 } as const,
  /** VERIFIED r2532a 2026-05-03 — task progress percentage 0..100. */
  TASK_PROGRESS_PCT: { siid: 4, piid: 63 } as const,
  /** VERIFIED r2532a — mop-drying progress (minutes ticking during MopDrying). */
  DRYING_PROGRESS: { siid: 4, piid: 64 } as const,
  /**
   * Map "PATH" push — the OSS object name of the latest map frame the robot
   * uploaded (the value passed to {@link VacuumDevice.getMap}). Arrives via the
   * MQTT push during/after cleaning; NOT in `DEFAULT_PROPS` because it is not
   * polled (it is pushed). Read it through {@link VacuumDevice.mapFilename}.
   */
  MAP_PATH: { siid: 6, piid: 3 } as const,
} as const;

/**
 * Vacuum-service actions. `callAction` builds the single-OBJECT params shape
 * (an array surfaces a misleading code 80001). START_CUSTOM carries the
 * segment/zone/spot payload as in-params (piid 1 = mode, piid 10 = JSON).
 */
export const VACUUM_ACTION = {
  /** ASSUMED Tasshack — start cleaning. */
  START: { siid: 2, aiid: 1 } as const,
  /** VERIFIED r2532a — pause (code 0 while idle). */
  PAUSE: { siid: 2, aiid: 2 } as const,
  /** ASSUMED Tasshack — return to dock / charge. */
  CHARGE: { siid: 3, aiid: 1 } as const,
  /** ASSUMED Tasshack — START_CUSTOM (segment/zone/spot; needs in payload). */
  START_CUSTOM: { siid: 4, aiid: 1 } as const,
  /** VERIFIED r2532a — stop (code 0 while idle). */
  STOP: { siid: 4, aiid: 2 } as const,
  /** VERIFIED r2532a 2026-05-02 — clear warning (code 0). */
  CLEAR_WARNING: { siid: 4, aiid: 3 } as const,
  /** ASSUMED Tasshack — start dock mop wash. */
  START_WASHING: { siid: 4, aiid: 4 } as const,
  /** VERIFIED r2532a 2026-05-02 — locate (robot beeps, code 0). */
  LOCATE: { siid: 7, aiid: 1 } as const,
  /** ASSUMED Tasshack — manual auto-empty trigger. */
  START_AUTO_EMPTY: { siid: 15, aiid: 1 } as const,
} as const;

/** Battery service (siid 3). */
export const BATTERY_PROP = {
  /** VERIFIED r2532a — battery percentage. */
  LEVEL: { siid: 3, piid: 1 } as const,
  /** VERIFIED r2532a — charging status (ChargingStatus). */
  CHARGING_STATUS: { siid: 3, piid: 2 } as const,
} as const;

/** Settings service — P3 needs voice volume only. */
export const SETTINGS_PROP = {
  /** ASSUMED Tasshack types.py:642 — voice volume 0-100. */
  VOLUME: { siid: 7, piid: 1 } as const,
} as const;

/** Consumables — % remaining (VERIFIED r2532a; note filter % is on piid 1). */
export const CONSUMABLE_PROP = {
  MAIN_BRUSH_LEFT: { siid: 9, piid: 2 } as const,
  SIDE_BRUSH_LEFT: { siid: 10, piid: 2 } as const,
  FILTER_LEFT: { siid: 11, piid: 1 } as const,
} as const;

/** START_CUSTOM mode ints (siid 4 piid 1 in-param). Tasshack device.py. */
export const CUSTOM_CLEAN_MODE = {
  SEGMENT: 18,
  ZONE: 19,
  SPOT: 20,
} as const;
