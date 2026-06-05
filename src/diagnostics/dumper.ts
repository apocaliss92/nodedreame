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
import type { DeviceDump } from './dump-format.js';

/** The `catalog` slice of a {@link DeviceDump}. */
type DumpCatalog = DeviceDump['catalog'];
type DumpCommand = NonNullable<DumpCatalog['commands']>[number];

/**
 * Build the STATIC catalog for a device: its declared command/action map +
 * resolved capability tokens. Reads only static maps + the capability getter —
 * NEVER invokes an action. Cast-free: the `*_ACTION` maps are plain records of
 * `{ siid, aiid }`, iterated with `Object.entries`.
 */
export function buildCatalog(device: BaseDevice): DumpCatalog {
  const commands: DumpCommand[] = [];
  if (device instanceof VacuumDevice) {
    for (const [name, ref] of Object.entries(VACUUM_ACTION)) {
      commands.push({ name, siid: ref.siid, aiid: ref.aiid });
    }
  } else if (device instanceof MowerDevice) {
    for (const [name, ref] of Object.entries(MOWER_ACTION)) {
      commands.push({ name, siid: ref.siid, aiid: ref.aiid });
    }
  }
  const tokens = device.capabilities.list();
  return {
    commands,
    capabilities: { tokens: [...tokens] },
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
