/**
 * MIoT surface of the Dreame camera service (SIID 10001), reversed byte-exact
 * from the r2538z (X50) React-Native plugin `Monitor` model. Every camera
 * control the app issues is a MIoT `action` on this service; the values below
 * are the verbatim aiid/piid maps from the bundle.
 */

/** The camera/monitor service id. Same across the X40/X50 vacuum class. */
export const MONITOR_SIID = 10001;

/** Action instance ids on {@link MONITOR_SIID}. */
export const MONITOR_AIID = {
  /** Stream lifecycle + keep-alive (monitor start/end, keep_alive). */
  CAMERA_OPERATE: 1,
  /** Two-way intercom start/end. */
  VOICE_OPERATE: 2,
  /** Generic property-scoped operations. */
  PROPERTY_OPERATE: 3,
  /** Privacy access-code gate (launch/verify/set/reset). */
  ACCESS_CODE_OPERATE: 4,
  /** Video-vendor SDK init / switch. */
  VIDEO_VENDOR: 7,
} as const;

/** Property instance ids on {@link MONITOR_SIID}. */
export const MONITOR_PIID = {
  MONITOR_STATUS: 1,
  MONITOR_AUDIO_STATUS: 2,
  MONITOR_RECORD_STATUS: 4,
  TAKE_PHOTO: 5,
  KEEP_ALIVE: 6,
  MONITOR_FAULTS: 7,
  FILL_LIGHT_SET: 9,
  CAMERA_LIGHT_SWITCH: 10,
  VIDEO_VENDOR_STATUS: 11,
  GET_PROPERTY: 99,
  PERSON_DATA: 110,
  VIDEO_OBSTACLE_SWITCH: 111,
  VIDEO_OBSTACLE_DATA: 112,
  MONITOR_TASK_STATUS: 103,
  UPLOAD_STATUS: 1003,
  GET_ACCESS_CODE: 1100,
  SET_ACCESS_CODE: 1101,
  VERIFY_ACCESS_CODE: 1102,
  MONITOR_REST_MODE: 1103,
  SET_ACCESS_HOT_STATUS: 1104,
  MONITOR_SPACE: 2003,
} as const;

/**
 * The `token` field the `startMonitor` action expects, keyed by vendor. Aliyun
 * LinkVisual uses the literal `"alify"`; Tencent uses `"tx"`. (Agora passes an
 * RTC access token instead and is not modelled here.)
 */
export const MONITOR_VENDOR_TOKEN: Record<'ali' | 'tx', string> = {
  ali: 'alify',
  tx: 'tx',
};

/** Fill-light: values 40..100 are manual %, below 40 (or 101) select auto. */
export const FILL_LIGHT_MIN = 40;

/**
 * The vacuum work service (SIID 4). The camera has no gimbal — "PTZ" and the
 * camera-adjacent controls (remote drive, go-to-point, person-follow) drive the
 * robot itself through this service.
 */
export const VACUUM_SIID = 4;
export const VACUUM_MOVE = {
  /** Remote-drive state property (set_properties), sent ~1 Hz while held. */
  REMOTE_STATE_PIID: 15,
  /** Work-mode action instance (go-to-point, cruise, person-follow start). */
  WORK_AIID: 1,
  /** Work-mode stop action instance (person-follow stop). */
  STOP_AIID: 2,
  /** piid carrying the work-mode selector value in the WORK action. */
  MODE_PIID: 1,
  /** piid carrying the point-info JSON in the WORK action. */
  POINT_PIID: 10,
  /** Work-mode selector values. */
  MODE_SPOT: 23, // go to point (MonitorSpotMode)
  MODE_CRUISE: 22, // cruise / patrol / find-pet
  MODE_PERSON_FOLLOW: 26,
  MODE_SPOT_CLEAN: 20, // spot-clean the current position (SpotClean)
  /** Auto-switch setter property (fill-light auto/full toggle lives here). */
  AUTO_SWITCH_PIID: 50,
} as const;

/** Return-to-dock / charge action (battery service). */
export const VACUUM_CHARGE = { siid: 3, aiid: 1 } as const;

/**
 * Voice/audio service (SIID 7). aiid 1 = position/locate (robot beeps), aiid 2 =
 * playSound (play a sound clip by id, carried in piid 4).
 */
export const VOICE_SIID = 7;
export const VOICE_LOCATE_AIID = 1;
export const VOICE_PLAY_SOUND_AIID = 2;
export const VOICE_SOUND_PIID = 4;
/** Locate action — the robot beeps so you can find it. */
export const VACUUM_LOCATE = { siid: VOICE_SIID, aiid: VOICE_LOCATE_AIID } as const;

/** Pet-teasing sound clips playable via {@link VOICE_PLAY_SOUND_AIID}. */
export const PET_SOUNDS = {
  meow: 684,
  bark: 685,
  footsteps: 686,
  purring: 687,
  tickTock: 688,
} as const;
export type PetSound = keyof typeof PET_SOUNDS;

/** Common whole-robot actions (usable as camera presets). */
export const VACUUM_ACTIONS = {
  startClean: { siid: 2, aiid: 1 },
  pauseClean: { siid: 2, aiid: 2 },
  stopClean: { siid: 4, aiid: 2 },
  dockWash: { siid: 4, aiid: 4 },
  autoEmpty: { siid: 15, aiid: 1 },
} as const;
export type VacuumActionKey = keyof typeof VACUUM_ACTIONS;
