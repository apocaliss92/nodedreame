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
