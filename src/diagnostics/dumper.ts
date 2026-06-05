import { BaseDevice } from '../device/base-device.js';
import { VacuumDevice } from '../models/vacuum/vacuum-device.js';
import { MowerDevice } from '../models/mower/mower-device.js';
import { VACUUM_ACTION } from '../models/vacuum/properties.js';
import { MOWER_ACTION } from '../models/mower/properties.js';
import { enumLookup } from '../models/_shared/decode.js';
import {
  ChargingStatus,
  CleaningMode,
  MiotState,
  SuctionLevel,
  TaskStatus,
  WaterVolume,
} from '../models/vacuum/enums.js';
import {
  MowerChargingStatus,
  MowerFault,
  MowerStatus,
  MowerTaskStatus,
} from '../models/mower/enums.js';
import { redact } from './redact.js';
import { LIBRARY_VERSION } from '../support/version.js';
import type { DeviceEvent, PropertyChangedEvent } from '../api/types.js';
import type { Nodreame } from '../api/nodreame.js';
import { DeviceDumpSchema, type DeviceDump } from './dump-format.js';

/** The `catalog` slice of a {@link DeviceDump}. */
type DumpCatalog = DeviceDump['catalog'];
type DumpCommand = NonNullable<DumpCatalog['commands']>[number];

/**
 * Static command list for a device family, read from the model's `*_ACTION` map.
 * Cast-free: the maps are plain records of `{ siid, aiid }`. NEVER executes one.
 */
function commandsForFamily(family: 'vacuum' | 'mower' | 'device'): DumpCommand[] {
  const commands: DumpCommand[] = [];
  if (family === 'vacuum') {
    for (const [name, ref] of Object.entries(VACUUM_ACTION)) {
      commands.push({ name, siid: ref.siid, aiid: ref.aiid });
    }
  } else if (family === 'mower') {
    for (const [name, ref] of Object.entries(MOWER_ACTION)) {
      commands.push({ name, siid: ref.siid, aiid: ref.aiid });
    }
  }
  return commands;
}

/**
 * Build the STATIC catalog for a device: its declared command/action map +
 * resolved capability tokens. Reads only static maps + the capability getter —
 * NEVER invokes an action.
 */
export function buildCatalog(device: BaseDevice): DumpCatalog {
  const family =
    device instanceof VacuumDevice ? 'vacuum' : device instanceof MowerDevice ? 'mower' : 'device';
  return {
    commands: commandsForFamily(family),
    capabilities: { tokens: [...device.capabilities.list()] },
  };
}

/** A property decoder: the enum NAME + a membership test for a raw number. */
interface KeyDecoder {
  enumName: string;
  isMember(raw: number): boolean;
}

function decoderFor<E extends number>(enumName: string, members: readonly E[]): KeyDecoder {
  const lookup = enumLookup<E>(members);
  return { enumName, isMember: (raw) => lookup(raw) !== null };
}

/**
 * Per-property decoder table for the VACUUM family, keyed by `"siid.piid"`.
 * Mirrors the `enumLookup` wiring the vacuum device uses for its `*Raw`/decoded
 * getters. Members are extracted cast-free via the predicate `filter` (identical
 * to `vacuum-device.ts`), so a raw number is never branded with a banned cast.
 */
export function vacuumDecoders(): Record<string, KeyDecoder> {
  return {
    '2.1': decoderFor(
      'MiotState',
      Object.values(MiotState).filter((v): v is MiotState => typeof v === 'number'),
    ),
    '3.2': decoderFor(
      'ChargingStatus',
      Object.values(ChargingStatus).filter((v): v is ChargingStatus => typeof v === 'number'),
    ),
    '4.4': decoderFor(
      'SuctionLevel',
      Object.values(SuctionLevel).filter((v): v is SuctionLevel => typeof v === 'number'),
    ),
    '4.5': decoderFor(
      'WaterVolume',
      Object.values(WaterVolume).filter((v): v is WaterVolume => typeof v === 'number'),
    ),
    '2.6': decoderFor(
      'CleaningMode',
      Object.values(CleaningMode).filter((v): v is CleaningMode => typeof v === 'number'),
    ),
    '4.1': decoderFor(
      'TaskStatus',
      Object.values(TaskStatus).filter((v): v is TaskStatus => typeof v === 'number'),
    ),
  };
}

/**
 * Per-property decoder table for the MOWER family, keyed by `"siid.piid"`.
 * Note vacuum and mower BOTH use keys `2.1`/`3.2` for DIFFERENT enums, so the
 * family-correct table MUST be injected — there is no shared default.
 */
export function mowerDecoders(): Record<string, KeyDecoder> {
  return {
    '2.1': decoderFor(
      'MowerStatus',
      Object.values(MowerStatus).filter((v): v is MowerStatus => typeof v === 'number'),
    ),
    '3.2': decoderFor(
      'MowerChargingStatus',
      Object.values(MowerChargingStatus).filter(
        (v): v is MowerChargingStatus => typeof v === 'number',
      ),
    ),
    '5.104': decoderFor(
      'MowerTaskStatus',
      Object.values(MowerTaskStatus).filter((v): v is MowerTaskStatus => typeof v === 'number'),
    ),
    '2.2': decoderFor(
      'MowerFault',
      Object.values(MowerFault).filter((v): v is MowerFault => typeof v === 'number'),
    ),
  };
}

type DumpScalar = string | number | boolean;
type PropertyObservation = DeviceDump['observations']['properties'][string];

function toScalar(value: unknown): DumpScalar | null {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return null;
}

interface AccEntry {
  values: DumpScalar[];
  unmapped: DumpScalar[];
  count: number;
  firstSeen: number;
  lastSeen: number;
}

/**
 * Accumulates per-property `(siid,piid)` → `"siid.piid"` observations: the
 * DISTINCT raw values seen (insertion order), a total `count`, first/last seen
 * timestamps, the mapped `enum` name (when a decoder is injected for the key),
 * and the subset of numeric values that DECODE TO NO KNOWN ENUM (`unmapped` —
 * the core crowd-sourcing signal). The family-correct decoder table is injected
 * at construction; a bare accumulator (no decoders) records values but never
 * flags unmapped.
 */
export class PropertyAccumulator {
  readonly #decoders: Record<string, KeyDecoder>;
  readonly #entries = new Map<string, AccEntry>();

  constructor(decoders: Record<string, KeyDecoder> = {}) {
    this.#decoders = decoders;
  }

  record(siid: number, piid: number, rawValue: unknown, at: number): void {
    const key = `${siid}.${piid}`;
    const scalar = toScalar(rawValue);
    let entry = this.#entries.get(key);
    if (!entry) {
      entry = { values: [], unmapped: [], count: 0, firstSeen: at, lastSeen: at };
      this.#entries.set(key, entry);
    }
    entry.count += 1;
    entry.lastSeen = at;
    if (scalar === null) {
      return; // non-scalar (object/array/null) — recorded as an observation count only
    }
    if (!entry.values.includes(scalar)) {
      entry.values.push(scalar);
    }
    const decoder = this.#decoders[key];
    if (decoder && typeof scalar === 'number' && !decoder.isMember(scalar)) {
      if (!entry.unmapped.includes(scalar)) {
        entry.unmapped.push(scalar);
      }
    }
  }

  snapshot(): Record<string, PropertyObservation> {
    const out: Record<string, PropertyObservation> = {};
    for (const [key, e] of this.#entries) {
      const decoder = this.#decoders[key];
      const base: PropertyObservation = {
        values: [...e.values],
        unmapped: [...e.unmapped],
        count: e.count,
        firstSeen: e.firstSeen,
        lastSeen: e.lastSeen,
      };
      out[key] = decoder ? { ...base, enum: decoder.enumName } : base;
    }
    return out;
  }
}

/** Tunables for a {@link Dumper}. All optional. */
export interface DumperOptions {
  /** Capture raw event/property frames into `observations.rawFrames`. Default false. */
  captureRawFrames?: boolean;
  /** Cap on retained raw frames (ring). Default 500. */
  maxRawFrames?: number;
  /** Periodic cloud-shadow refresh interval (ms). Default 30000; 0 disables. */
  refreshIntervalMs?: number;
}

/**
 * The READ-ONLY slice of a device the {@link Dumper} consumes. Declaring it as
 * an interface lets tests inject a fake with no cast (mirrors `PushLike`). A real
 * `BaseDevice`/`VacuumDevice`/`MowerDevice` structurally satisfies it. NOTE it
 * exposes NO action/command method — the dumper literally cannot execute one.
 */
export interface DumperDevice {
  readonly model: string;
  readonly deviceId: string;
  readonly capabilities: { list(): readonly string[]; has(t: string): boolean; model: string };
  on(event: 'propertyChanged', cb: (e: PropertyChangedEvent) => void): this;
  on(event: 'event', cb: (e: DeviceEvent) => void): this;
  off(event: 'propertyChanged', cb: (e: PropertyChangedEvent) => void): this;
  off(event: 'event', cb: (e: DeviceEvent) => void): this;
  /** Cloud-shadow read; absent on a bare BaseDevice. Feature-detected. */
  refreshFromCache?(): Promise<void>;
}

const DEFAULT_REFRESH_INTERVAL_MS = 30000;
const DEFAULT_MAX_RAW_FRAMES = 500;

type RawFrame = NonNullable<DeviceDump['observations']['rawFrames']>[number];

/**
 * A passive, READ-ONLY observer that records what a Dreame device exposes while
 * it operates. {@link start} hooks the device's `propertyChanged`/`event` stream,
 * does an initial + periodic cloud-shadow {@link DumperDevice.refreshFromCache}
 * read (feature-detected), and snapshots the static catalog at construction.
 * {@link stop} detaches every listener + clears the timer (idempotent, no leaks).
 * {@link export} assembles the ANONYMIZED, zod-valid {@link DeviceDump}. The
 * dumper NEVER executes a device command/action.
 */
export class Dumper {
  readonly #device: DumperDevice;
  readonly #opts: { captureRawFrames: boolean; maxRawFrames: number; refreshIntervalMs: number };
  readonly #acc: PropertyAccumulator;
  readonly #events: DeviceDump['observations']['events'] = [];
  readonly #rawFrames: RawFrame[] = [];
  readonly #catalog: DeviceDump['catalog'];
  readonly #type: string;
  readonly #onProperty: (e: PropertyChangedEvent) => void;
  readonly #onEvent: (e: DeviceEvent) => void;
  #timer: ReturnType<typeof setInterval> | null = null;
  #startedAt = 0;
  #started = false;

  constructor(
    device: DumperDevice,
    catalog: DeviceDump['catalog'],
    type: string,
    decoders: Record<string, KeyDecoder>,
    options: DumperOptions = {},
  ) {
    this.#device = device;
    this.#catalog = catalog;
    this.#type = type;
    this.#acc = new PropertyAccumulator(decoders);
    this.#opts = {
      captureRawFrames: options.captureRawFrames ?? false,
      maxRawFrames: options.maxRawFrames ?? DEFAULT_MAX_RAW_FRAMES,
      refreshIntervalMs: options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS,
    };
    // Bound listeners stored once so `off()` removes the EXACT same reference.
    this.#onProperty = (e): void => {
      this.#acc.record(e.siid, e.piid, e.value, Date.now());
      this.#pushRaw('mqtt:property', e);
    };
    this.#onEvent = (e): void => {
      this.#events.push({
        at: Date.now(),
        type: `${e.siid}.${e.eiid}`,
        data: { arguments: e.arguments },
      });
      this.#pushRaw('mqtt:event', e);
    };
  }

  /** Attach to the live stream + arm the periodic shadow refresh. Idempotent. */
  async start(): Promise<void> {
    if (this.#started) {
      return;
    }
    this.#started = true;
    this.#startedAt = Date.now();
    this.#device.on('propertyChanged', this.#onProperty);
    this.#device.on('event', this.#onEvent);
    await this.#refresh();
    if (this.#opts.refreshIntervalMs > 0 && this.#device.refreshFromCache) {
      this.#timer = setInterval(() => void this.#refresh(), this.#opts.refreshIntervalMs);
      this.#timer.unref?.();
    }
  }

  /** Detach every listener + clear the timer. Idempotent. */
  stop(): Promise<void> {
    if (!this.#started) {
      return Promise.resolve();
    }
    this.#started = false;
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    this.#device.off('propertyChanged', this.#onProperty);
    this.#device.off('event', this.#onEvent);
    return Promise.resolve();
  }

  /** Build the anonymized, schema-valid dump. Works live or after {@link stop}. */
  export(): DeviceDump {
    const now = Date.now();
    const dump: DeviceDump = {
      schemaVersion: 1,
      library: 'nodedreame',
      libraryVersion: LIBRARY_VERSION,
      device: {
        model: this.#device.model,
        type: this.#type,
      },
      observations: {
        properties: this.#acc.snapshot(),
        events: [...this.#events],
        ...(this.#opts.captureRawFrames ? { rawFrames: this.#redactFrames() } : {}),
      },
      catalog: this.#catalog,
      meta: {
        startedAt: this.#startedAt,
        durationMs: Math.max(0, now - this.#startedAt),
        generatedAt: now,
      },
    };
    // redact(dump) returns `unknown`; DeviceDumpSchema.parse re-types it back to
    // DeviceDump with ZERO cast (Zod's parse return type IS DeviceDump).
    const anonymized = redact(dump);
    return DeviceDumpSchema.parse(anonymized);
  }

  /** Deterministic pretty JSON of {@link export}. */
  exportJson(): string {
    return JSON.stringify(this.export(), null, 2);
  }

  async #refresh(): Promise<void> {
    if (this.#device.refreshFromCache) {
      try {
        await this.#device.refreshFromCache();
      } catch {
        // read-only best-effort — a shadow-read failure must never crash a dump.
      }
    }
  }

  #pushRaw(source: string, payload: unknown): void {
    if (!this.#opts.captureRawFrames) {
      return;
    }
    this.#rawFrames.push({ at: Date.now(), source, payload });
    if (this.#rawFrames.length > this.#opts.maxRawFrames) {
      this.#rawFrames.shift();
    }
  }

  #redactFrames(): RawFrame[] {
    return this.#rawFrames.map((f) => ({ at: f.at, source: f.source, payload: redact(f.payload) }));
  }
}

/**
 * The device family. A real device is classified by `instanceof`; a non-device
 * target (e.g. a test fake) falls back to its `model` prefix so the
 * family-correct decoder table/type still applies. Unknown → `'device'`.
 */
function familyOf(device: DumperDevice): 'vacuum' | 'mower' | 'device' {
  if (device instanceof VacuumDevice) {
    return 'vacuum';
  }
  if (device instanceof MowerDevice) {
    return 'mower';
  }
  if (!(device instanceof BaseDevice)) {
    if (device.model.startsWith('dreame.vacuum.')) {
      return 'vacuum';
    }
    if (device.model.startsWith('dreame.mower.')) {
      return 'mower';
    }
  }
  return 'device';
}

function decodersFor(device: DumperDevice): Record<string, KeyDecoder> {
  switch (familyOf(device)) {
    case 'vacuum':
      return vacuumDecoders();
    case 'mower':
      return mowerDecoders();
    default:
      return {};
  }
}

function typeFor(device: DumperDevice): string {
  return familyOf(device);
}

function catalogFor(device: DumperDevice): DeviceDump['catalog'] {
  // Family-based: a real device is classified by `instanceof` inside familyOf, a
  // test fake by model prefix. Equivalent to buildCatalog for a real BaseDevice,
  // but avoids re-narrowing to the generic BaseDevice<any>.
  return {
    commands: commandsForFamily(familyOf(device)),
    capabilities: { tokens: [...device.capabilities.list()] },
  };
}

/**
 * Create a read-only {@link Dumper} for one device. The family-correct decoder
 * table + catalog + `device.type` are chosen via cast-free `instanceof` checks;
 * an unknown family records values with no enum/unmapped detection.
 */
export function createDumper(target: DumperDevice, options?: DumperOptions): Dumper {
  return new Dumper(
    target,
    catalogFor(target),
    typeFor(target),
    decodersFor(target),
    options ?? {},
  );
}

/**
 * Fan-out: one {@link Dumper} per discovered device on a {@link Nodreame} client
 * (read-only). Each `BaseDevice` structurally satisfies {@link DumperDevice}.
 */
export function createClientDumper(client: Nodreame, options?: DumperOptions): Dumper[] {
  return client.devices.map((d) => createDumper(d, options));
}
