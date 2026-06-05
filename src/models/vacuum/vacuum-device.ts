import { BaseDevice, type BaseDeviceInput } from '../../device/base-device.js';
import {
  VACUUM_PROP,
  VACUUM_ACTION,
  BATTERY_PROP,
  SETTINGS_PROP,
  CONSUMABLE_PROP,
  CUSTOM_CLEAN_MODE,
} from './properties.js';
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
import { DreameError } from '../../transport/errors.js';

/** Knobs for the segment/zone/spot helpers. Defaults pull from cached state. */
export interface CleanOpts {
  repeats?: number;
  fan?: number;
  water?: number;
}

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

  // -- command helpers ----------------------------------------------------
  #resolveCleanOpts(opts: CleanOpts): { repeats: number; fan: number; water: number } {
    const repeats = Math.max(1, Math.trunc(opts.repeats ?? 1));
    const fan = opts.fan ?? this.suctionRaw ?? SuctionLevel.Standard;
    const water = opts.water ?? this.waterRaw ?? WaterVolume.Medium;
    return { repeats, fan, water };
  }

  #startCustom(mode: number, payload: Record<string, unknown>): Promise<unknown> {
    return this.callAction(VACUUM_ACTION.START_CUSTOM.siid, VACUUM_ACTION.START_CUSTOM.aiid, [
      { piid: 1, value: mode },
      { piid: 10, value: JSON.stringify(payload) },
    ]);
  }

  #requireCap(flag: boolean, op: string, feature: string): void {
    if (!flag) {
      throw new DreameError(`${op}: model ${this.model} does not support ${feature}`);
    }
  }

  // -- no-arg commands ----------------------------------------------------
  /**
   * Start cleaning (MIoT action siid 2 aiid 1). Named `startCleaning` — NOT
   * `start` — because `BaseDevice.start()` is the lifecycle method that opens
   * the MQTT push, and the facade relies on that meaning. Donor `node-dreame`
   * names this `start()` only because its standalone `Vacuum` class owns no
   * lifecycle method to collide with.
   */
  startCleaning(): Promise<unknown> {
    return this.callAction(VACUUM_ACTION.START.siid, VACUUM_ACTION.START.aiid, []);
  }
  pause(): Promise<unknown> {
    return this.callAction(VACUUM_ACTION.PAUSE.siid, VACUUM_ACTION.PAUSE.aiid, []);
  }
  stop(): Promise<unknown> {
    return this.callAction(VACUUM_ACTION.STOP.siid, VACUUM_ACTION.STOP.aiid, []);
  }
  /** Return to the dock / charge (MIoT action CHARGE, siid 3 aiid 1). */
  dock(): Promise<unknown> {
    return this.callAction(VACUUM_ACTION.CHARGE.siid, VACUUM_ACTION.CHARGE.aiid, []);
  }
  locate(): Promise<unknown> {
    return this.callAction(VACUUM_ACTION.LOCATE.siid, VACUUM_ACTION.LOCATE.aiid, []);
  }
  clearWarning(): Promise<unknown> {
    return this.callAction(VACUUM_ACTION.CLEAR_WARNING.siid, VACUUM_ACTION.CLEAR_WARNING.aiid, []);
  }
  async startAutoEmpty(): Promise<unknown> {
    this.#requireCap(this.#caps.canAutoEmpty, 'startAutoEmpty', 'auto-empty');
    return this.callAction(
      VACUUM_ACTION.START_AUTO_EMPTY.siid,
      VACUUM_ACTION.START_AUTO_EMPTY.aiid,
      [],
    );
  }

  // -- settings writes ----------------------------------------------------
  /** Type-safe suction write. Validates against the model's supported levels. */
  setSuction(level: SuctionLevel): Promise<unknown> {
    return this.setSuctionRaw(level);
  }
  /**
   * Untyped suction write: validates an arbitrary number against the model's
   * supported levels and rejects with `RangeError` on an invalid input. This
   * is the raw-input entry point so callers (and tests) can exercise validation
   * with no type assertions. `async` so the guard surfaces as a rejection.
   */
  async setSuctionRaw(level: number): Promise<unknown> {
    if (!this.#caps.supportedSuctionLevels.includes(level)) {
      throw new RangeError(`setSuction: unsupported suction level ${String(level)}`);
    }
    return this.setProperty({ ...VACUUM_PROP.SUCTION_LEVEL, value: level });
  }
  /** Type-safe water-volume write. Validates against supported volumes. */
  setWater(volume: WaterVolume): Promise<unknown> {
    return this.setWaterRaw(volume);
  }
  /** Untyped water-volume write: validates an arbitrary number (zero casts). */
  async setWaterRaw(volume: number): Promise<unknown> {
    if (!this.#caps.supportedWaterVolumes.includes(volume)) {
      throw new RangeError(`setWater: unsupported water volume ${String(volume)}`);
    }
    return this.setProperty({ ...VACUUM_PROP.WATER_VOLUME, value: volume });
  }
  /** SAFE clean-mode write — uses CLEAN_MODE_SETTING (siid 2 piid 6), never the 0x1400 bitfield. */
  setCleaningMode(mode: CleaningMode): Promise<unknown> {
    return this.setProperty({ ...VACUUM_PROP.CLEAN_MODE_SETTING, value: mode });
  }

  // -- targeted cleaning --------------------------------------------------
  async cleanSegments(ids: number[], opts: CleanOpts = {}): Promise<unknown> {
    this.#requireCap(this.#caps.canCleanPerRoom, 'cleanSegments', 'per-room cleaning');
    if (ids.length === 0) {
      throw new RangeError('cleanSegments: ids must not be empty');
    }
    const { repeats, fan, water } = this.#resolveCleanOpts(opts);
    const selects = ids.map((id) => [id, repeats, fan, water, 1]);
    return this.#startCustom(CUSTOM_CLEAN_MODE.SEGMENT, { selects });
  }
  async cleanZones(
    zones: Array<{ x0: number; y0: number; x1: number; y1: number }>,
    opts: CleanOpts = {},
  ): Promise<unknown> {
    this.#requireCap(this.#caps.canCleanPerRoom, 'cleanZones', 'per-room cleaning');
    if (zones.length === 0) {
      throw new RangeError('cleanZones: zones must not be empty');
    }
    const { repeats, fan, water } = this.#resolveCleanOpts(opts);
    const areas = zones.map((z) => [
      Math.round(z.x0),
      Math.round(z.y0),
      Math.round(z.x1),
      Math.round(z.y1),
      repeats,
      fan,
      water,
    ]);
    return this.#startCustom(CUSTOM_CLEAN_MODE.ZONE, { areas });
  }
  /**
   * Send the robot to clean a single point (the SPOT custom-clean action,
   * mode 20). ASSUMED: Tasshack's "go to point" is the same SPOT action — this
   * is exposed as `cleanSpot` because it maps to the spot/custom-clean action,
   * not a distinct go-to. No separate `goTo` is exposed.
   */
  async cleanSpot(point: { x: number; y: number }, opts: CleanOpts = {}): Promise<unknown> {
    this.#requireCap(this.#caps.canCleanPerRoom, 'cleanSpot', 'per-room cleaning');
    const { repeats, fan, water } = this.#resolveCleanOpts(opts);
    const points = [[Math.round(point.x), Math.round(point.y), repeats, fan, water]];
    return this.#startCustom(CUSTOM_CLEAN_MODE.SPOT, { points });
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
