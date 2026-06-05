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
 * Only `SpotIncomplete` (7) has a confirmed meaning; the donor explicitly marks
 * codes 2/3/10/13 as "Unknown task status: N" (observed after RAIN/LOST/
 * LOW_BATTERY events). Those are NOT invented as named members — they surface as
 * raw via {@link MowerDevice.taskStatusRaw}. This is the FULL documented set:
 * the donor names exactly one code.
 */
export enum MowerTaskStatus {
  /** "Task incomplete - spot mowing". */
  SpotIncomplete = 7,
}

/**
 * Mower device-code / fault value space for DEVICE_CODE (siid 2 piid 2). This is
 * the FULL donor `BASE_DEVICE_CODES` registry (property/device_code.py), codes
 * 0..73 contiguous. Each integer is documented by the donor with a name +
 * severity (INFO / WARNING / ERROR — noted inline). 0 = NO_DEVICE_CODE (normal
 * operation). Codes not in this table (model-specific extensions) fall through
 * the cast-free lookup and surface as raw via {@link MowerDevice.faultRaw}.
 *
 * Two donor names repeat at different integers; the second occurrence is
 * suffixed (`LidarDirtyWarning` 38, `BatteryOverheatWarning` 42) to keep enum
 * member names unique while preserving the integer source of truth.
 */
export enum MowerFault {
  NoDeviceCode = 0, // INFO
  Tilted = 1, // ERROR
  Trapped = 2, // ERROR
  NarrowPathToStation = 3, // ERROR
  LeftWheel = 4, // ERROR
  RightWheel = 5, // ERROR
  LiftMotor = 6, // ERROR
  Cutter = 7, // ERROR
  SidedMotor = 8, // ERROR
  CrashPlate = 9, // ERROR
  Charging = 10, // ERROR
  BatteryOverheat = 11, // ERROR
  LidarCovered = 12, // ERROR
  LidarOverheatWithoutMap = 13, // ERROR
  LidarOverheatWithMap = 14, // ERROR
  LidarOverheat = 15, // ERROR
  LidarDirty = 16, // ERROR
  LidarAbnormal = 17, // ERROR
  LocationWeak = 18, // ERROR
  LocationLost = 19, // ERROR
  Sensor = 20, // ERROR
  InForbiddenArea = 21, // ERROR
  OutOfMap = 22, // ERROR
  EmergencyStop = 23, // ERROR
  BatteryLow = 24, // ERROR
  MapFileCrack = 25, // ERROR
  AwayFromMap = 26, // ERROR
  HumanDetected = 27, // ERROR
  BladeLoss = 28, // ERROR
  StationLoss = 29, // ERROR
  MaintainLoss = 30, // ERROR
  BackChargeFailed = 31, // WARNING
  DockingFailed = 32, // WARNING
  LocatingFailedWithMap = 33, // WARNING
  LocatingFailedWithoutMap = 34, // WARNING
  LocatingAbnormal = 35, // WARNING
  TaskStartFailed = 36, // WARNING
  PathImpassable = 37, // ERROR
  LidarDirtyWarning = 38, // WARNING (donor LIDAR_DIRTY at 38)
  CamDirty = 39, // WARNING
  CamAbnormal = 40, // WARNING
  CamCover = 41, // WARNING
  BatteryOverheatWarning = 42, // WARNING (donor BATTERY_OVERHEAT at 42)
  BatteryTempLow = 43, // WARNING
  AutobuildBorder = 44, // WARNING
  AutobuildSide = 45, // WARNING
  BorderFinish = 46, // INFO
  NewMap = 47, // INFO
  TaskFinish = 48, // INFO
  DestinationNotReachable = 49, // INFO
  TaskStart = 50, // INFO
  CruiseStart = 51, // INFO
  PointAndGoStart = 52, // INFO
  ScheduleStart = 53, // INFO
  BatteryLowReturning = 54, // INFO
  BatteryLowScheduleSuspend = 55, // INFO
  BadWeatherProtecting = 56, // INFO
  RainScheduleInterupted = 57, // INFO
  RainScheduleSuspend = 58, // INFO
  ForzenReturning = 59, // INFO
  FrozenScheduleSuspend = 60, // INFO
  NotDisturbReturning = 61, // INFO
  NotDisturbScheduleSuspend = 62, // INFO
  WorkingScheduleSuspend = 63, // INFO
  RemoteControlingScheduleSuspend = 64, // INFO
  EmergencyStoppedScheduleSuspend = 65, // INFO
  TopCoverOpenScheduleSuspend = 66, // INFO
  FaultModeScheduleSuspend = 67, // INFO
  ScheduleTimeout = 68, // INFO
  StationNotConnectedToWorkingArea = 69, // INFO
  ContinueFromBreakpoint = 70, // INFO
  IdleTimeoutReturning = 71, // INFO
  PauseTimeoutReturning = 72, // INFO
  TopCoverOpen = 73, // ERROR
}
