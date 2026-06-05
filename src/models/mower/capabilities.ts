/**
 * Per-model mower capability records + a resolver adapting the rich record into
 * the generic CapabilityResolver the BaseDevice expects (mirrors the vacuum
 * capability layer). The donor (antondaubert/dreame-mower) has no per-model
 * capability matrix for mowers, so the targeted-mowing flags are ASSUMED working
 * hypotheses from the donor command surface; verified:false until live-checked.
 */
import type { CapabilityResolver, DeviceCapabilities } from '../../device/capability.js';

/** Rich mower capability record. `canX` = behaviour the model accepts. */
export interface MowerCapabilities {
  model: string;
  /** true only for live-confirmed records (false = assumed / fallback). */
  verified: boolean;
  /** Zone-selective mowing (2:50 o:102). */
  canMowZones: boolean;
  /** Edge / contour mowing (2:50 o:101). */
  canMowEdges: boolean;
  /** Spot mowing (2:50 o:103). */
  canMowSpots: boolean;
  /** All-area, map-targeted start (2:50 o:100). */
  canMowAllArea: boolean;
  /** Resume after pause (2:50 o:5). Generic to the mower action surface. */
  canResume: boolean;
  /** Has a scheduling task descriptor (2:50). */
  canSchedule: boolean;
}

const FALLBACK: Omit<MowerCapabilities, 'model'> = {
  verified: false,
  canMowZones: false,
  canMowEdges: false,
  canMowSpots: false,
  canMowAllArea: false,
  canResume: true,
  canSchedule: true,
};

/** A1-family body (ASSUMED from the donor command surface; not live-verified). */
const A1_FAMILY: Omit<MowerCapabilities, 'model' | 'verified'> = {
  canMowZones: true,
  canMowEdges: true,
  canMowSpots: true,
  canMowAllArea: true,
  canResume: true,
  canSchedule: true,
};

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj)) {
      deepFreeze(v);
    }
  }
  return obj;
}

export const MODEL_CAPABILITIES: Readonly<Record<string, MowerCapabilities>> = {
  /** Dreame A1 — the user's mower. ASSUMED from the donor command surface. */
  'dreame.mower.p2255': { model: 'dreame.mower.p2255', verified: false, ...A1_FAMILY },
};

for (const entry of Object.values(MODEL_CAPABILITIES)) {
  deepFreeze(entry);
}

/** Resolve a model to its rich mower capability record (frozen / fallback). */
export function getMowerCapabilities(model: string): MowerCapabilities {
  const known = MODEL_CAPABILITIES[model];
  if (known) {
    return known;
  }
  return deepFreeze({ model, ...FALLBACK });
}

/** Map the rich record's booleans -> the generic capability token set. */
function tokensFor(c: MowerCapabilities): Set<string> {
  const tokens = new Set<string>();
  const add = (flag: boolean, token: string): void => {
    if (flag) {
      tokens.add(token);
    }
  };
  add(c.canMowZones, 'mow-zones');
  add(c.canMowEdges, 'mow-edges');
  add(c.canMowSpots, 'mow-spots');
  add(c.canMowAllArea, 'mow-all-area');
  add(c.canResume, 'resume');
  add(c.canSchedule, 'schedule');
  return tokens;
}

class MowerCapabilitySet implements DeviceCapabilities {
  readonly model: string;
  readonly #tokens: ReadonlySet<string>;
  constructor(model: string, tokens: ReadonlySet<string>) {
    this.model = model;
    this.#tokens = tokens;
  }
  has(token: string): boolean {
    return this.#tokens.has(token);
  }
  list(): readonly string[] {
    return [...this.#tokens];
  }
}

/** Resolver the BaseDevice accepts via BaseDeviceInput.capabilities. */
export class MowerCapabilityResolver implements CapabilityResolver {
  resolve(model: string): DeviceCapabilities {
    return new MowerCapabilitySet(model, tokensFor(getMowerCapabilities(model)));
  }
}
