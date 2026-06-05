import { BaseDevice, type BaseDeviceInput } from '../../device/base-device.js';
import { VACUUM_PROP, BATTERY_PROP, SETTINGS_PROP, CONSUMABLE_PROP } from './properties.js';
import {
  ChargingStatus,
  CleaningMode,
  MiotState,
  SuctionLevel,
  TaskStatus,
  WaterVolume,
} from './enums.js';
import { asNum, parseFaultList } from './decode.js';
import {
  VacuumCapabilityResolver,
  getVacuumCapabilities,
  type VacuumCapabilities,
} from './capabilities.js';

/**
 * Cast-free enum narrower: returns the matching ENUM-typed member or null.
 * `members.find(...)` is already `E | undefined`, so no banned cast is needed
 * to narrow a raw number back to an enum literal.
 */
function enumLookup<E extends number>(members: readonly E[]): (n: number | null) => E | null {
  const set = new Set<number>(members);
  return (n) => (n !== null && set.has(n) ? (members.find((m) => m === n) ?? null) : null);
}

const SUCTION = enumLookup<SuctionLevel>([
  SuctionLevel.Quiet,
  SuctionLevel.Standard,
  SuctionLevel.Intense,
  SuctionLevel.Max,
]);
const WATER = enumLookup<WaterVolume>([WaterVolume.Low, WaterVolume.Medium, WaterVolume.High]);
const CLEAN_MODE = enumLookup<CleaningMode>([
  CleaningMode.Sweeping,
  CleaningMode.Mopping,
  CleaningMode.SweepAndMop,
  CleaningMode.MopAfterSweep,
]);
const STATE = enumLookup<MiotState>(
  Object.values(MiotState).filter((v): v is MiotState => typeof v === 'number'),
);
const CHARGING = enumLookup<ChargingStatus>([
  ChargingStatus.Charging,
  ChargingStatus.Discharging,
  ChargingStatus.Returning,
]);
const TASK = enumLookup<TaskStatus>([
  TaskStatus.InterruptedOrPaused,
  TaskStatus.Active,
  TaskStatus.Transitioning,
  TaskStatus.OnDockIdle,
  TaskStatus.TransientPauseEdge,
  TaskStatus.NeedsIntervention,
]);

/** A typed Dreame-vacuum handle (state + capability-gated commands). */
export class VacuumDevice extends BaseDevice {
  readonly #caps: VacuumCapabilities;

  constructor(input: BaseDeviceInput) {
    super({
      ...input,
      // Inject the vacuum resolver so the inherited generic `capabilities`
      // getter carries the vacuum token set (no banned cast).
      capabilities:
        input.capabilities ?? new VacuumCapabilityResolver().resolve(input.device.model),
    });
    this.#caps = getVacuumCapabilities(input.device.model);
  }

  /** Rich, vacuum-specific capability record (booleans + supported enums). */
  get vacuumCapabilities(): VacuumCapabilities {
    return this.#caps;
  }

  #num(siid: number, piid: number): number | null {
    return asNum(this.getProperty(siid, piid)?.value);
  }

  // -- typed state --------------------------------------------------------
  get statusRaw(): number | null {
    return this.#num(VACUUM_PROP.STATE.siid, VACUUM_PROP.STATE.piid);
  }
  get status(): MiotState | null {
    return STATE(this.statusRaw);
  }
  get battery(): number | null {
    return this.#num(BATTERY_PROP.LEVEL.siid, BATTERY_PROP.LEVEL.piid);
  }
  get chargingRaw(): number | null {
    return this.#num(BATTERY_PROP.CHARGING_STATUS.siid, BATTERY_PROP.CHARGING_STATUS.piid);
  }
  get charging(): ChargingStatus | null {
    return CHARGING(this.chargingRaw);
  }
  get isCharging(): boolean {
    return this.charging === ChargingStatus.Charging;
  }
  /** Docked => MiotState Charging or ChargingComplete (on the dock). */
  get isDocked(): boolean {
    const s = this.status;
    return s === MiotState.Charging || s === MiotState.ChargingComplete;
  }
  get suctionRaw(): number | null {
    return this.#num(VACUUM_PROP.SUCTION_LEVEL.siid, VACUUM_PROP.SUCTION_LEVEL.piid);
  }
  get suction(): SuctionLevel | null {
    return SUCTION(this.suctionRaw);
  }
  get waterRaw(): number | null {
    return this.#num(VACUUM_PROP.WATER_VOLUME.siid, VACUUM_PROP.WATER_VOLUME.piid);
  }
  get water(): WaterVolume | null {
    return WATER(this.waterRaw);
  }
  /** Reads the SAFE CLEAN_MODE_SETTING (siid 2 piid 6), plain 0-3. */
  get cleaningModeRaw(): number | null {
    return this.#num(VACUUM_PROP.CLEAN_MODE_SETTING.siid, VACUUM_PROP.CLEAN_MODE_SETTING.piid);
  }
  get cleaningMode(): CleaningMode | null {
    return CLEAN_MODE(this.cleaningModeRaw);
  }
  get taskStatusRaw(): number | null {
    return this.#num(VACUUM_PROP.TASK_STATUS.siid, VACUUM_PROP.TASK_STATUS.piid);
  }
  get taskStatus(): TaskStatus | null {
    return TASK(this.taskStatusRaw);
  }
  get errorCode(): number | null {
    return this.#num(VACUUM_PROP.ERROR.siid, VACUUM_PROP.ERROR.piid);
  }
  get faults(): readonly number[] {
    return parseFaultList(
      this.getProperty(VACUUM_PROP.FAULTS_STR.siid, VACUUM_PROP.FAULTS_STR.piid)?.value,
    );
  }
  get taskProgressPct(): number | null {
    return this.#num(VACUUM_PROP.TASK_PROGRESS_PCT.siid, VACUUM_PROP.TASK_PROGRESS_PCT.piid);
  }
  get mainBrushLeftPct(): number | null {
    return this.#num(CONSUMABLE_PROP.MAIN_BRUSH_LEFT.siid, CONSUMABLE_PROP.MAIN_BRUSH_LEFT.piid);
  }
  get sideBrushLeftPct(): number | null {
    return this.#num(CONSUMABLE_PROP.SIDE_BRUSH_LEFT.siid, CONSUMABLE_PROP.SIDE_BRUSH_LEFT.piid);
  }
  get filterLeftPct(): number | null {
    return this.#num(CONSUMABLE_PROP.FILTER_LEFT.siid, CONSUMABLE_PROP.FILTER_LEFT.piid);
  }
  get volume(): number | null {
    return this.#num(SETTINGS_PROP.VOLUME.siid, SETTINGS_PROP.VOLUME.piid);
  }

  // NOTE: `currentSegmentId` is intentionally NOT exposed in P3. There is no
  // verified single-property source for the current room id — Tasshack derives
  // it from the live MAP, which lands in P5. We do not ship an always-null
  // placeholder getter; the accessor arrives with the map layer.

  /** Props worth seeding on start() / polling — exported for the facade. */
  static readonly DEFAULT_PROPS = [
    VACUUM_PROP.STATE,
    VACUUM_PROP.ERROR,
    VACUUM_PROP.FAULTS_STR,
    VACUUM_PROP.TASK_STATUS,
    VACUUM_PROP.SUCTION_LEVEL,
    VACUUM_PROP.WATER_VOLUME,
    VACUUM_PROP.CLEAN_MODE_SETTING,
    VACUUM_PROP.TASK_PROGRESS_PCT,
    BATTERY_PROP.LEVEL,
    BATTERY_PROP.CHARGING_STATUS,
    CONSUMABLE_PROP.MAIN_BRUSH_LEFT,
    CONSUMABLE_PROP.SIDE_BRUSH_LEFT,
    CONSUMABLE_PROP.FILTER_LEFT,
    SETTINGS_PROP.VOLUME,
  ] as const;
}
