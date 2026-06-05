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
  AutoWaterDraining = 33,
  ShortcutRunning = 97,
  CameraMonitoring = 98,
  CameraMonitoringPaused = 99,
  InitialDeepClean = 101,
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
 * (siid 4 piid 18). VERIFIED members confirmed live on r2532a; the rest are
 * ASSUMED from Tasshack types.py — the integer is the source of truth.
 */
export enum MiotError {
  Clear = 0,
  WheelRotationAnomaly = 1,
  RobotLifted = 18,
  TaskComplete = 68,
  ManualMopInstallRequired = 74,
  WastewaterTankFull = 105,
  CleanWaterTankEmpty = 107,
  WashboardFilterNeedsCleaning = 114,
  MopPadsMissing = 120,
  // ASSUMED from Tasshack — battery / charging
  BatteryLow = 20,
  ChargeFault = 21,
  BatteryPercentageAnomaly = 22,
  ChargeNoElectric = 28,
  BatteryFault = 29,
  LowBatteryTurnOff = 75,
  // ASSUMED from Tasshack — stuck family
  RobotStuck = 80,
  RobotStuckRepeat = 81,
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
  RobotStuckOnCurtain = 200,
  // ASSUMED from Tasshack — bin / dock / dust
  BinFull = 101,
  StationDisconnected = 117,
  DustBagFull = 121,
}

/** VERIFIED on r2532a 2026-05-02 — TASK_STATUS (siid 4 piid 1). */
export enum TaskStatus {
  InterruptedOrPaused = 1,
  Active = 2,
  Transitioning = 3,
  OnDockIdle = 6,
  TransientPauseEdge = 12,
  NeedsIntervention = 14,
}
