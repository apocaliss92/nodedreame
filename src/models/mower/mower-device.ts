import { BaseDevice, type BaseDeviceInput } from '../../device/base-device.js';
import {
  MOWER_ACTION,
  MOWER_PROP,
  buildAllAreaPayload,
  buildEdgePayload,
  buildResumePayload,
  buildSpotPayload,
  buildZonePayload,
} from './properties.js';
import { MowerChargingStatus, MowerControlAction, MowerStatus } from './enums.js';
import {
  asNum,
  enumLookup,
  parseControlStatus,
  parseTaskDescriptor,
  type MowerControlState,
  type MowerTaskDescriptor,
} from './decode.js';
import {
  MowerCapabilityResolver,
  getMowerCapabilities,
  type MowerCapabilities,
} from './capabilities.js';
import { DreameError } from '../../transport/errors.js';
import {
  parseBatchMapData,
  renderMowerSvg,
  type MowerMap,
  type RenderMowerSvgOptions,
} from './map/index.js';

/**
 * Injectable batch-fetch seam. Given a device id + the batch property groups
 * (e.g. `['MAP','M_PATH']`), resolves the raw `{ 'MAP.0': …, 'MAP.info': … }`
 * chunk dict the firmware returns. The default wires `getBatchDeviceDatas` from
 * the cloud layer — but its live endpoint path is NOT yet recovered (see
 * `cloud/commands.ts`), so production callers MUST inject a working fetcher.
 * Tests inject a fake with no cast.
 */
export type BatchDeviceDataFetcher = (
  did: string,
  props: string[],
) => Promise<Record<string, unknown>>;

/** Default batch property groups the firmware exposes the vector map under. */
export const DEFAULT_MAP_PROPS: readonly string[] = ['MAP', 'M_PATH'];

/** Mower-specific construction input: adds the injectable batch-fetch seam. */
export interface MowerDeviceInput extends BaseDeviceInput {
  /** Inject the batched device-data fetcher (maps). Tests pass a fake. */
  getBatchDeviceDatas?: BatchDeviceDataFetcher;
}

const STATUS = enumLookup<MowerStatus>(
  Object.values(MowerStatus).filter((v): v is MowerStatus => typeof v === 'number'),
);
const CHARGING = enumLookup<MowerChargingStatus>(
  Object.values(MowerChargingStatus).filter((v): v is MowerChargingStatus => typeof v === 'number'),
);

/** A typed Dreame-mower handle (state + capability-gated commands). */
export class MowerDevice extends BaseDevice {
  readonly #caps: MowerCapabilities;
  readonly #fetchBatch: BatchDeviceDataFetcher | null;
  #lastMap: MowerMap | null = null;

  constructor(input: MowerDeviceInput) {
    super({
      ...input,
      // Inject the mower resolver so the inherited generic `capabilities` getter
      // carries the mower token set (no banned cast).
      capabilities: input.capabilities ?? new MowerCapabilityResolver().resolve(input.device.model),
    });
    this.#caps = getMowerCapabilities(input.device.model);
    this.#fetchBatch = input.getBatchDeviceDatas ?? null;
  }

  /** Rich, mower-specific capability record. */
  get mowerCapabilities(): MowerCapabilities {
    return this.#caps;
  }

  #num(siid: number, piid: number): number | null {
    return asNum(this.getProperty(siid, piid)?.value);
  }

  // -- typed state --------------------------------------------------------
  get statusRaw(): number | null {
    return this.#num(MOWER_PROP.STATUS.siid, MOWER_PROP.STATUS.piid);
  }
  get status(): MowerStatus | null {
    return STATUS(this.statusRaw);
  }
  get battery(): number | null {
    return this.#num(MOWER_PROP.BATTERY.siid, MOWER_PROP.BATTERY.piid);
  }
  get chargingRaw(): number | null {
    return this.#num(MOWER_PROP.CHARGING_STATUS.siid, MOWER_PROP.CHARGING_STATUS.piid);
  }
  get charging(): MowerChargingStatus | null {
    return CHARGING(this.chargingRaw);
  }
  /** Docked => on the dock (Charging / ChargingComplete state). */
  get isDocked(): boolean {
    const s = this.status;
    return s === MowerStatus.Charging || s === MowerStatus.ChargingComplete;
  }
  get isMowing(): boolean {
    return this.status === MowerStatus.Mowing;
  }
  get taskStatusRaw(): number | null {
    return this.#num(MOWER_PROP.TASK_STATUS.siid, MOWER_PROP.TASK_STATUS.piid);
  }
  /** Parsed scheduling task descriptor (2:50), or null. */
  get task(): MowerTaskDescriptor | null {
    return parseTaskDescriptor(
      this.getProperty(MOWER_PROP.SCHEDULING_TASK.siid, MOWER_PROP.SCHEDULING_TASK.piid)?.value,
    );
  }
  /**
   * Mowing coverage target / progress signal from the task descriptor (`d.o`).
   * This is the P4 progress surface; the byte-accurate pose-track % is P5.
   */
  get coverageTargetPct(): number | null {
    return this.task?.coverageTarget ?? null;
  }
  /** Parsed per-zone control status (2:56), or null. */
  get controlStatus(): MowerControlState | null {
    return parseControlStatus(
      this.getProperty(MOWER_PROP.MOWER_CONTROL_STATUS.siid, MOWER_PROP.MOWER_CONTROL_STATUS.piid)
        ?.value,
    );
  }
  get controlAction(): MowerControlAction | null {
    return this.controlStatus?.action ?? null;
  }

  // -- command helpers ----------------------------------------------------
  #requireCap(flag: boolean, op: string, feature: string): void {
    if (!flag) {
      throw new DreameError(`${op}: model ${this.model} does not support ${feature}`);
    }
  }

  /** Send a scheduling-task action (2:50) carrying a single opcode object. */
  #sendTask(payload: Record<string, unknown>): Promise<unknown> {
    return this.callAction(MOWER_PROP.SCHEDULING_TASK.siid, MOWER_PROP.SCHEDULING_TASK.piid, [
      payload,
    ]);
  }

  // -- no-arg commands ----------------------------------------------------
  /**
   * Start the generic mowing action (siid 5 aiid 1). Named `startMowing` — NOT
   * `start` — because `BaseDevice.start()` is the MQTT lifecycle method the
   * facade relies on; overriding it would break handle startup.
   */
  startMowing(): Promise<unknown> {
    return this.callAction(MOWER_ACTION.START_MOWING.siid, MOWER_ACTION.START_MOWING.aiid, []);
  }
  pause(): Promise<unknown> {
    return this.callAction(MOWER_ACTION.PAUSE.siid, MOWER_ACTION.PAUSE.aiid, []);
  }
  stop(): Promise<unknown> {
    return this.callAction(MOWER_ACTION.STOP.siid, MOWER_ACTION.STOP.aiid, []);
  }
  /** Send the mower to its dock (siid 5 aiid 3). */
  dock(): Promise<unknown> {
    return this.callAction(MOWER_ACTION.DOCK.siid, MOWER_ACTION.DOCK.aiid, []);
  }
  /**
   * Resume mowing after a pause. Encoded as the continueControl opcode
   * `{m:'a', p:0, o:5}` sent as the single in-param of the SCHEDULING_TASK
   * (2:50) action — NOT a siid-5 action. Mirrors the donor TASK_PAYLOAD_RESUME.
   */
  async resume(): Promise<unknown> {
    this.#requireCap(this.#caps.canResume, 'resume', 'resume');
    return this.#sendTask(buildResumePayload());
  }

  // -- targeted mowing ----------------------------------------------------
  /** All-area, map-targeted mowing (2:50 o:100). */
  async startMowingAllArea(mapId: number): Promise<unknown> {
    this.#requireCap(this.#caps.canMowAllArea, 'startMowingAllArea', 'all-area mowing');
    return this.#sendTask(buildAllAreaPayload(Math.trunc(mapId)));
  }
  /** Zone-selective mowing (2:50 o:102). */
  async startMowingZones(zoneIds: number[]): Promise<unknown> {
    this.#requireCap(this.#caps.canMowZones, 'startMowingZones', 'zone mowing');
    if (zoneIds.length === 0) {
      throw new RangeError('startMowingZones: zoneIds must not be empty');
    }
    return this.#sendTask(buildZonePayload(zoneIds.map((z) => Math.trunc(z))));
  }
  /** Edge / contour mowing (2:50 o:101). Contour ids are two-int pairs [[1,0]]. */
  async startMowingEdges(contourIds: number[][]): Promise<unknown> {
    this.#requireCap(this.#caps.canMowEdges, 'startMowingEdges', 'edge mowing');
    if (contourIds.length === 0) {
      throw new RangeError('startMowingEdges: contourIds must not be empty');
    }
    return this.#sendTask(buildEdgePayload(contourIds));
  }
  /** Spot mowing (2:50 o:103). */
  async startMowingSpots(spotAreaIds: number[]): Promise<unknown> {
    this.#requireCap(this.#caps.canMowSpots, 'startMowingSpots', 'spot mowing');
    if (spotAreaIds.length === 0) {
      throw new RangeError('startMowingSpots: spotAreaIds must not be empty');
    }
    return this.#sendTask(buildSpotPayload(spotAreaIds.map((s) => Math.trunc(s))));
  }

  /**
   * Seed the cache from the CLOUD SHADOW (last-known values) WITHOUT waking the
   * mower — reads {@link MowerDevice.DEFAULT_PROPS} from the cloud-cached
   * endpoint. After it resolves, every typed getter (status/battery/charging/
   * coverage/task/controlAction…) reflects the cached values, so a docked/
   * standby mower reports its state exactly as the Dreamehome app does.
   */
  async refreshFromCache(): Promise<void> {
    await this.refreshCachedProperties([...MowerDevice.DEFAULT_PROPS]);
  }

  // -- maps ---------------------------------------------------------------
  /** The most-recently-parsed map, or `null` until {@link getMap} succeeds. */
  get lastMap(): MowerMap | null {
    return this.#lastMap;
  }

  /**
   * Fetch the batched vector-map data, parse it into a {@link MowerMap}, cache
   * it as {@link lastMap}, and return it. Capability-gated on `canMap`.
   *
   * The batch fetcher is injected at construction (the live cloud endpoint path
   * is not yet recovered — see `cloud/commands.ts`). Rejects with
   * {@link DreameError} if no fetcher was injected or the batch yields no
   * parseable map (asleep mower / empty data).
   */
  async getMap(props: readonly string[] = DEFAULT_MAP_PROPS): Promise<MowerMap> {
    this.#requireCap(this.#caps.canMap, 'getMap', 'map parsing');
    if (!this.#fetchBatch) {
      throw new DreameError(
        'getMap: no batch device-data fetcher injected (live endpoint unrecovered)',
      );
    }
    const batch = await this.#fetchBatch(this.deviceId, [...props]);
    const map = parseBatchMapData(batch);
    if (!map) {
      throw new DreameError('getMap: batch device-data contained no parseable map');
    }
    this.#lastMap = map;
    return map;
  }

  /**
   * Render the current map to a deterministic SVG string. Uses {@link lastMap}
   * when present, otherwise fetches first via {@link getMap}.
   */
  async mapSvg(opts?: RenderMowerSvgOptions): Promise<string> {
    const map = this.#lastMap ?? (await this.getMap());
    return renderMowerSvg(map, opts ?? {});
  }

  /** Props worth seeding on start() / polling — exported for the facade. */
  static readonly DEFAULT_PROPS = [
    MOWER_PROP.STATUS,
    MOWER_PROP.BATTERY,
    MOWER_PROP.CHARGING_STATUS,
    MOWER_PROP.TASK_STATUS,
    MOWER_PROP.SCHEDULING_TASK,
    MOWER_PROP.MOWER_CONTROL_STATUS,
  ] as const;
}
