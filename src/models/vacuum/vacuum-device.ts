import {
  BaseDevice,
  type BaseDeviceInput,
  type BaseDeviceEvents,
} from '../../device/base-device.js';
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
import { enumLookup } from '../_shared/decode.js';
import {
  VacuumCapabilityResolver,
  getVacuumCapabilities,
  type VacuumCapabilities,
} from './capabilities.js';
import { DreameError } from '../../transport/errors.js';
import {
  decodeVacuumMap,
  OssFetcher,
  type VacuumMap,
  type OssFetchInput,
  type OssFetcherLike,
} from './map/index.js';
import { REGION_HOSTS } from '../../auth/config.js';

/** Knobs for the segment/zone/spot helpers. Defaults pull from cached state. */
export interface CleanOpts {
  repeats?: number;
  fan?: number;
  water?: number;
}

/**
 * The vacuum widens the {@link BaseDeviceEvents} map with a `'map'` event,
 * emitted by {@link VacuumDevice.getMap} once a fresh map has been decoded.
 * Declaring it here lets `VacuumDevice extends BaseDevice<VacuumDeviceEvents>`
 * type the emitter with no banned cast.
 */
export type VacuumDeviceEvents = BaseDeviceEvents & {
  map: [VacuumMap];
};

/** Input to {@link VacuumDevice.getMap}. */
export interface VacuumGetMapInput {
  /** OSS object name advertised via the PATH push (siid 6 piid 3). */
  filename: string;
  /**
   * Inject the signed-blob fetcher (tests pass a fake). Defaults to a fresh
   * {@link OssFetcher}. Typed as {@link OssFetcherLike} so consumers can pass
   * any object exposing a compatible `fetchBlob`.
   */
  fetcher?: OssFetcherLike;
  /** Optional AES key for an encrypted blob (hex). */
  key?: string;
  /** Optional AES IV for an encrypted blob (hex). */
  iv?: string;
  /** Override the API host (defaults from the device region). */
  host?: string;
  /** Per-request timeout override in ms. */
  timeoutMs?: number;
  /** Caller-supplied AbortSignal. */
  signal?: AbortSignal;
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
export class VacuumDevice extends BaseDevice<VacuumDeviceEvents> {
  readonly #caps: VacuumCapabilities;
  #lastMap: VacuumMap | null = null;

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

  /**
   * The suction levels this model supports, as a {@link SuctionLevel} enum array
   * (from the capability record). Lets a consumer see which fan speeds are
   * selectable without reaching into {@link vacuumCapabilities}.
   */
  get supportedSuctionLevels(): readonly SuctionLevel[] {
    return this.#caps.supportedSuctionLevels;
  }
  /** The water/mop volumes this model supports, as a {@link WaterVolume} enum array. */
  get supportedWaterVolumes(): readonly WaterVolume[] {
    return this.#caps.supportedWaterVolumes;
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
    // Argument validation precedes capability gating (donor convention): an
    // empty array throws RangeError regardless of model capability.
    if (ids.length === 0) {
      throw new RangeError('cleanSegments: ids must not be empty');
    }
    this.#requireCap(this.#caps.canCleanPerRoom, 'cleanSegments', 'per-room cleaning');
    const { repeats, fan, water } = this.#resolveCleanOpts(opts);
    const selects = ids.map((id) => [id, repeats, fan, water, 1]);
    return this.#startCustom(CUSTOM_CLEAN_MODE.SEGMENT, { selects });
  }
  async cleanZones(
    zones: Array<{ x0: number; y0: number; x1: number; y1: number }>,
    opts: CleanOpts = {},
  ): Promise<unknown> {
    // Argument validation precedes capability gating (donor convention): an
    // empty array throws RangeError regardless of model capability.
    if (zones.length === 0) {
      throw new RangeError('cleanZones: zones must not be empty');
    }
    this.#requireCap(this.#caps.canCleanPerRoom, 'cleanZones', 'per-room cleaning');
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

  /**
   * Seed the cache from the CLOUD SHADOW (last-known values) WITHOUT waking the
   * robot — reads {@link VacuumDevice.DEFAULT_PROPS} from the cloud-cached
   * endpoint. After it resolves, every typed getter (status/battery/suction/
   * water/cleaningMode/error/charging…) reflects the cached values, so a
   * standby/docked vacuum reports its state exactly as the Dreamehome app does.
   */
  async refreshFromCache(): Promise<void> {
    await this.refreshCachedProperties([...VacuumDevice.DEFAULT_PROPS]);
  }

  // -- maps ---------------------------------------------------------------
  /** The most-recently-decoded map, or `null` until {@link getMap} succeeds. */
  get lastMap(): VacuumMap | null {
    return this.#lastMap;
  }

  /**
   * The OSS object name of the latest map frame the robot advertised via its
   * PATH push (siid 6 piid 3), or `null` when none has been observed yet (the
   * robot has not uploaded a map since connect). This is the `filename` to pass
   * to {@link getMap} — or just call {@link fetchLatestMap}.
   */
  get mapFilename(): string | null {
    const v = this.getProperty(VACUUM_PROP.MAP_PATH.siid, VACUUM_PROP.MAP_PATH.piid)?.value;
    return typeof v === 'string' && v.length > 0 ? v : null;
  }

  /**
   * Convenience: fetch + decode the LATEST map frame the robot advertised,
   * reading {@link mapFilename} and delegating to {@link getMap}. Returns `null`
   * when no map filename has been observed yet (vs throwing) so a consumer can
   * poll it safely; once a filename is present it behaves exactly like
   * {@link getMap} (capability-gated on `canMap`, caches {@link lastMap}, emits
   * `'map'`). The `fetcher`/`key`/`iv`/`host`/`timeoutMs`/`signal` overrides are
   * forwarded verbatim.
   */
  async fetchLatestMap(opts: Omit<VacuumGetMapInput, 'filename'> = {}): Promise<VacuumMap | null> {
    const filename = this.mapFilename;
    if (filename === null) return null;
    return this.getMap({ filename, ...opts });
  }

  /**
   * Seed {@link mapFilename} from the CLOUD SHADOW (the last value the robot
   * pushed for siid 6 piid 3) WITHOUT waking it — so a docked/idle robot can
   * surface its LAST cleaning map without a fresh clean. Emits the usual
   * `propertyChanged`/`stateChanged` (so a map-watching consumer re-renders) and
   * returns the resolved {@link mapFilename} (null when the model has no map or
   * the shadow carries no map path yet).
   *
   * NOTE: the shadow holds the last LIVE-PATH filename; its OSS blob may have
   * expired, in which case a follow-up {@link fetchLatestMap} rejects — treat
   * that as "no saved map available".
   */
  async refreshSavedMapFilename(): Promise<string | null> {
    if (!this.#caps.canMap) return null;
    await this.refreshCachedProperties([VACUUM_PROP.MAP_PATH]);
    return this.mapFilename;
  }

  /**
   * The current room/segment id, derived from the most-recently-decoded map's
   * active-segment set (`sa`). `null` when no map has been fetched or no
   * segment is currently active. REPLACES the P3 "intentionally not exposed"
   * placeholder — the value now comes from the decoded map layer (P5).
   */
  get currentSegmentId(): number | null {
    return this.#lastMap?.segments.find((s) => s.active)?.id ?? null;
  }

  /**
   * Fetch the current saved/live-map blob (OSS), decode it, cache it as
   * {@link lastMap}, emit a `'map'` event, and return the {@link VacuumMap}.
   *
   * Capability-gated on `canMap`. The `filename` is the OSS object name the
   * caller resolves from a `mapInfo`/PATH push. The fetcher is injectable so
   * tests drive it with a synthetic blob and no live network.
   *
   * NOTE: active live-frame P-frame STREAMING (continuous merge orchestration)
   * is a documented follow-up; `getMap` resolves a single frame here. The
   * `applyVacuumPFrame` merge primitive ships separately for that work.
   */
  async getMap(input: VacuumGetMapInput): Promise<VacuumMap> {
    this.#requireCap(this.#caps.canMap, 'getMap', 'map decoding');
    const session = this.currentSession();
    const region = this.region;
    const fetcher = input.fetcher ?? new OssFetcher();
    const fetchInput: OssFetchInput = {
      host: input.host ?? REGION_HOSTS[region],
      accessToken: session.accessToken,
      region,
      did: this.deviceId,
      model: this.model,
      filename: input.filename,
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
    };
    const blob = await fetcher.fetchBlob(fetchInput);
    const map = decodeVacuumMap(blob, {
      ...(input.key !== undefined ? { key: input.key } : {}),
      ...(input.iv !== undefined ? { iv: input.iv } : {}),
    });
    this.#lastMap = map;
    this.emit('map', map);
    return map;
  }

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
