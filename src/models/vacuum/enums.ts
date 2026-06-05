/**
 * Vacuum MIoT enum definitions (ported from malard/node-dreame
 * src/spec/enums.ts, MIT — attribution retained). Only the state/command
 * enums P3 needs are ported here; dock/schedule enums land in later phases.
 * Annotations (VERIFIED <date> / ASSUMED from Tasshack) are preserved.
 */

/**
 * VERIFIED on r2532a 2026-05-02 — MIoT STATE (siid 2 piid 1). Sourced from
 * the device's keyDefine v8 JSON. 19 values verified live across a full
 * cleaning task; sub-mode: value 1 = vacuum-only, value 12 = vacuum+mop.
 */
export enum MiotState {
  Cleaning = 1,
  Standby = 2,
  Paused = 3,
  PausedAlt = 4,
  ReturningToCharge = 5,
  Charging = 6,
  Mopping = 7,
  MopDrying = 8,
  MopCleaning = 9,
  ReturningToWash = 10,
  Mapping = 11,
  CleaningAlt = 12,
  ChargingComplete = 13,
  Updating = 14,
  CallToClean = 15,
  AutoRepairBase = 16,
  ReturnInstallMop = 17,
  ReturnRemoveMop = 18,
  WaterSupplyDrainTest = 19,
  CleanMopRefillWater = 20,
  PausedCleaning = 21,
  AutoEmptying = 22,
  RemoteCleaning = 23,
  IntelligentCharging = 24,
  SecondCleaning = 25,
  Following = 26,
  PartialCleaning = 27,
  ReturnToEmpty = 28,
  WaitingForTask = 29,
  CleanWashboardBase = 30,
  // ASSUMED from Tasshack (DreameVacuumState) — codes 31-38 not yet live-verified.
  ReturningToDrain = 31,
  Draining = 32,
  AutoWaterDraining = 33,
  Emptying = 34,
  DustBagDrying = 35,
  DustBagDryingPaused = 36,
  HeadingToExtraCleaning = 37,
  ExtraCleaning = 38,
  FindingPetPaused = 95,
  FindingPet = 96,
  ShortcutRunning = 97,
  CameraMonitoring = 98,
  CameraMonitoringPaused = 99,
  InitialDeepClean = 101,
  // ASSUMED from Tasshack (DreameVacuumState) — codes 102-108.
  InitialDeepCleanPaused = 102,
  Sanitizing = 103,
  SanitizingWithDry = 104,
  ChangingMop = 105,
  ChangingMopPaused = 106,
  FloorMaintaining = 107,
  FloorMaintainingPaused = 108,
}

/** VERIFIED on r2532a 2026-05-02 — ChargingStatus (siid 3 piid 2). */
export enum ChargingStatus {
  Charging = 1,
  Discharging = 2,
  Returning = 5,
}

/** VERIFIED on r2532a 2026-05-02 — SuctionLevel (siid 4 piid 4). X50 labels. */
export enum SuctionLevel {
  Quiet = 0,
  Standard = 1,
  Intense = 2,
  Max = 3,
}

/** ASSUMED from Tasshack — WaterVolume (siid 4 piid 5). NOT YET verified on r2532a. */
export enum WaterVolume {
  Low = 1,
  Medium = 2,
  High = 3,
}

/**
 * VERIFIED on r2449a 2026-05-21 — plain 0..3 value space written via
 * CLEAN_MODE_SETTING (siid 2 piid 6). The raw CLEANING_MODE field (siid 4
 * piid 23) packs this in its low 2 bits OR'd with a 0x1400 capability mask;
 * prefer CLEAN_MODE_SETTING to avoid the bitfield trap.
 */
export enum CleaningMode {
  Sweeping = 0,
  Mopping = 1,
  SweepAndMop = 2,
  MopAfterSweep = 3,
}

/**
 * Error / fault value space for ERROR (siid 2 piid 2) and FAULTS_STR
 * (siid 4 piid 18). This is the FULL Tasshack `DreameVacuumErrorCode` table
 * (types.py) — every documented integer is mapped. Members whose names were
 * VERIFIED live on r2532a keep their verified labels even where the donor uses
 * a different label for the same integer (annotated inline); the rest carry the
 * donor's documented name. UNKNOWN (-1) is intentionally omitted — an unknown
 * code falls through the cast-free lookup and surfaces as the raw number.
 */
export enum MiotError {
  Clear = 0, // donor NO_ERROR
  WheelRotationAnomaly = 1, // donor DROP (VERIFIED label kept)
  Cliff = 2,
  Bumper = 3,
  Gesture = 4,
  BumperRepeat = 5,
  DropRepeat = 6,
  OpticalFlow = 7,
  Box = 8,
  TankBox = 9,
  WaterBoxEmpty = 10,
  BoxFull = 11,
  Brush = 12,
  SideBrush = 13,
  Fan = 14,
  LeftWheelMotor = 15,
  RightWheelMotor = 16,
  TurnSuffocate = 17,
  RobotLifted = 18, // donor FORWARD_SUFFOCATE (VERIFIED label kept)
  ChargerGet = 19,
  BatteryLow = 20,
  ChargeFault = 21,
  BatteryPercentageAnomaly = 22, // donor BATTERY_PERCENTAGE
  Heart = 23,
  CameraOcclusion = 24,
  Move = 25,
  FlowShielding = 26,
  InfraredShielding = 27,
  ChargeNoElectric = 28,
  BatteryFault = 29,
  FanSpeedError = 30,
  LeftWheelSpeed = 31,
  RightWheelSpeed = 32,
  Bmi055Acce = 33,
  Bmi055Gyro = 34,
  Xv7001 = 35,
  LeftMagnet = 36,
  RightMagnet = 37,
  FlowError = 38,
  InfraredFault = 39,
  CameraFault = 40,
  StrongMagnet = 41,
  WaterPump = 42,
  Rtc = 43,
  AutoKeyTrig = 44,
  P3v3 = 45,
  CameraIdle = 46,
  Blocked = 47,
  LdsError = 48,
  LdsBumper = 49,
  WaterPump2 = 50,
  FilterBlocked = 51,
  Edge = 54,
  Carpet = 55,
  Laser = 56,
  Edge2 = 57,
  Ultrasonic = 58,
  NoGoZone = 59,
  Route = 61,
  Route2 = 62,
  Blocked2 = 63,
  Blocked3 = 64,
  Restricted = 65,
  Restricted2 = 66,
  Restricted3 = 67,
  TaskComplete = 68, // donor REMOVE_MOP (VERIFIED label kept)
  MopRemoved = 69,
  MopRemoved2 = 70,
  MopPadStopRotate = 71,
  MopPadStopRotate2 = 72,
  ManualMopInstallRequired = 74, // donor MOP_INSTALL_FAILED (VERIFIED label kept)
  LowBatteryTurnOff = 75,
  DirtyTankNotInstalled = 76,
  RobotInHiddenRoom = 78,
  LdsFailedToLift = 79,
  RobotStuck = 80,
  RobotStuckRepeat = 81,
  SlipperyFloor = 82,
  UnknownError = 84,
  CheckMopInstall = 85,
  DirtyWaterTankFull = 86,
  RetractableLegStuck = 88,
  InternalError = 89,
  RobotStuck2 = 90,
  RobotStuckOnTables = 91,
  RobotStuckOnPassage = 92,
  RobotStuckOnThreshold = 93,
  RobotStuckOnLowLyingArea = 94,
  RobotStuckOnRamp = 95,
  RobotStuckOnObstacle = 96,
  RobotStuckOnPet = 97,
  RobotStuckOnSlipperySurface = 98,
  RobotStuckOnCarpet = 99,
  BinFull = 101,
  BinOpen = 102,
  BinOpen2 = 103,
  BinFull2 = 104,
  WastewaterTankFull = 105, // donor WATER_TANK (VERIFIED label kept)
  DirtyWaterTank = 106,
  CleanWaterTankEmpty = 107, // donor WATER_TANK_DRY (VERIFIED label kept)
  DirtyWaterTank2 = 108,
  DirtyWaterTankBlocked = 109,
  DirtyWaterTankPump = 110,
  MopPad = 111,
  WetMopPad = 112,
  WashboardFilterNeedsCleaning = 114, // donor CLEAN_MOP_PAD (VERIFIED label kept)
  CleanTankLevel = 116,
  StationDisconnected = 117,
  DirtyTankLevel = 118,
  WashboardLevel = 119,
  MopPadsMissing = 120, // donor NO_MOP_IN_STATION (VERIFIED label kept)
  DustBagFull = 121,
  UnknownWarning = 122,
  SelfTestFailed = 123,
  WashboardNotWorking = 124,
  DrainageFailed = 125,
  MopNotDetected = 126,
  MopHolderError = 127,
  DockError = 128,
  WashFailed = 129,
  RobotStuckOnCurtain = 200,
  EdgeMopStopRotate = 201,
  EdgeMopDetached = 202,
  ChassisLiftMalfunction = 203,
  InternalError2 = 207,
  MopCoverError = 209,
  RollerMopError = 210,
  OnboardWaterTankEmpty = 213,
  OnboardDirtyWaterTankFull = 214,
  MopNotInstalled = 215,
  RollerMopError2 = 218,
  FluffingRollerError = 222,
  MopCoverError2 = 223,
  BlockedByObstacle = 226,
  ReturnToChargeFailed = 1000,
}

/**
 * TASK_STATUS (siid 4 piid 1). Codes 1/2/3/6/12/14 carry the labels VERIFIED
 * live on r2532a 2026-05-02 — these are KEPT verbatim because they were
 * observed against real task transitions and differ from the donor's labels for
 * the same integers (donor: 1=AUTO_CLEANING, 2=ZONE_CLEANING, 3=SEGMENT_CLEANING,
 * 6=AUTO_CLEANING_PAUSED, 12=MOPPING_PAUSED, 14=ZONE_MOPPING_PAUSED). The
 * remaining members are ASSUMED from Tasshack `DreameVacuumTaskStatus`
 * (types.py) — added so documented codes resolve to a name. Unknown codes
 * surface as raw via {@link VacuumDevice.taskStatusRaw}.
 */
export enum TaskStatus {
  // ASSUMED from Tasshack
  Completed = 0,
  // VERIFIED live
  InterruptedOrPaused = 1,
  Active = 2,
  Transitioning = 3,
  // ASSUMED from Tasshack
  SpotCleaning = 4,
  FastMapping = 5,
  // VERIFIED live
  OnDockIdle = 6,
  // ASSUMED from Tasshack
  ZoneCleaningPaused = 7,
  SegmentCleaningPaused = 8,
  SpotCleaningPaused = 9,
  MapCleaningPaused = 10,
  DockingPaused = 11,
  // VERIFIED live
  TransientPauseEdge = 12,
  // ASSUMED from Tasshack
  SegmentMoppingPaused = 13,
  // VERIFIED live
  NeedsIntervention = 14,
  // ASSUMED from Tasshack
  AutoMoppingPaused = 15,
  AutoDockingPaused = 16,
  SegmentDockingPaused = 17,
  ZoneDockingPaused = 18,
  CruisingPath = 20,
  CruisingPathPaused = 21,
  CruisingPoint = 22,
  CruisingPointPaused = 23,
  SummonCleanPaused = 24,
  ReturningInstallMop = 25,
  ReturningRemoveMop = 26,
  StationCleaning = 27,
  PetFinding = 30,
  AutoCleaningWashingPaused = 31,
  AreaCleaningWashingPaused = 32,
  CustomCleaningWashingPaused = 33,
}
