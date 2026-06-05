/**
 * Per-model vacuum capability records (ported from malard/node-dreame
 * src/capabilities.ts, MIT — attribution retained) plus a resolver that
 * adapts the rich record into the generic CapabilityResolver the BaseDevice
 * expects. r2538z is added mirroring r2532a (X50 sibling), marked unverified
 * until live-confirmed.
 */
import { SuctionLevel, WaterVolume } from './enums.js';
import type { CapabilityResolver, DeviceCapabilities } from '../../device/capability.js';

/** Rich vacuum capability record. `canX` = behaviour, `hasX` = hardware. */
export interface VacuumCapabilities {
  model: string;
  /** true when the record came from the curated table (false = fallback / assumed). */
  verified: boolean;
  canMop: boolean;
  canAutoInstallMop: boolean;
  hasSideBrush: boolean;
  hasCamera: boolean;
  hasCarpetSensor: boolean;
  hasAiObstacleDetection: boolean;
  canAutoEmpty: boolean;
  canMopWash: boolean;
  canMopDry: boolean;
  canHeatMopWater: boolean;
  hasDetergentReservoir: boolean;
  canCleanPerRoom: boolean;
  supportsVirtualWalls: boolean;
  supportsNoGoZones: boolean;
  hasChildLock: boolean;
  supportsMultiFloor: boolean;
  /** Decodes/fetches the binary live/saved map (envelope → pixel grid → segments). */
  canMap: boolean;
  supportedSuctionLevels: readonly SuctionLevel[];
  supportedWaterVolumes: readonly WaterVolume[];
}

const FALLBACK: Omit<VacuumCapabilities, 'model'> = {
  verified: false,
  canMop: false,
  canAutoInstallMop: false,
  hasSideBrush: true,
  hasCamera: false,
  hasCarpetSensor: false,
  hasAiObstacleDetection: false,
  canAutoEmpty: false,
  canMopWash: false,
  canMopDry: false,
  canHeatMopWater: false,
  hasDetergentReservoir: false,
  canCleanPerRoom: false,
  supportsVirtualWalls: false,
  supportsNoGoZones: false,
  hasChildLock: false,
  supportsMultiFloor: false,
  // Map decoding is model-agnostic (binary frame format is identical across
  // the lineup); the fallback record leaves it false so an unknown model does
  // not advertise a feature we have not verified its firmware exposes.
  canMap: false,
  supportedSuctionLevels: [
    SuctionLevel.Quiet,
    SuctionLevel.Standard,
    SuctionLevel.Intense,
    SuctionLevel.Max,
  ],
  supportedWaterVolumes: [WaterVolume.Low, WaterVolume.Medium, WaterVolume.High],
};

/** Full-feature X50-family record body (r2532a verified; r2538z assumed sibling). */
const X50_FAMILY: Omit<VacuumCapabilities, 'model' | 'verified'> = {
  canMop: true,
  canAutoInstallMop: true,
  hasSideBrush: true,
  hasCamera: true,
  hasCarpetSensor: true,
  hasAiObstacleDetection: true,
  canAutoEmpty: true,
  canMopWash: true,
  canMopDry: true,
  canHeatMopWater: true,
  hasDetergentReservoir: true,
  canCleanPerRoom: true,
  supportsVirtualWalls: true,
  supportsNoGoZones: true,
  hasChildLock: true,
  supportsMultiFloor: true,
  canMap: true,
  supportedSuctionLevels: [
    SuctionLevel.Quiet,
    SuctionLevel.Standard,
    SuctionLevel.Intense,
    SuctionLevel.Max,
  ],
  supportedWaterVolumes: [WaterVolume.Low, WaterVolume.Medium, WaterVolume.High],
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

export const MODEL_CAPABILITIES: Readonly<Record<string, VacuumCapabilities>> = {
  /** Dreame X40 Ultra Complete — VERIFIED r2449a (2026-05-21). */
  'dreame.vacuum.r2449a': { model: 'dreame.vacuum.r2449a', verified: true, ...X50_FAMILY },
  /** Dreame X50 Ultra Complete — VERIFIED r2532a (firmware 4.3.9_2199, 2026-05-02). */
  'dreame.vacuum.r2532a': { model: 'dreame.vacuum.r2532a', verified: true, ...X50_FAMILY },
  /**
   * Dreame r2538z — the user's device. ASSUMED from the r2532a (X50) sibling:
   * same dock-side feature set is the working hypothesis. Marked verified:false
   * until confirmed live (e2e). Flip to true + drop this note once verified.
   */
  'dreame.vacuum.r2538z': { model: 'dreame.vacuum.r2538z', verified: false, ...X50_FAMILY },
};

for (const entry of Object.values(MODEL_CAPABILITIES)) {
  deepFreeze(entry);
}

/** Resolve a model to its rich vacuum capability record (frozen / fallback). */
export function getVacuumCapabilities(model: string): VacuumCapabilities {
  const known = MODEL_CAPABILITIES[model];
  if (known) {
    return known;
  }
  return deepFreeze({ model, ...FALLBACK });
}

/** Map the rich record's booleans → the generic capability token set. */
function tokensFor(c: VacuumCapabilities): Set<string> {
  const tokens = new Set<string>();
  const add = (flag: boolean, token: string): void => {
    if (flag) {
      tokens.add(token);
    }
  };
  add(c.canMop, 'mop');
  add(c.canAutoInstallMop, 'auto-install-mop');
  add(c.hasSideBrush, 'side-brush');
  add(c.hasCamera, 'camera');
  add(c.hasCarpetSensor, 'carpet-sensor');
  add(c.hasAiObstacleDetection, 'ai-obstacle');
  add(c.canAutoEmpty, 'auto-empty');
  add(c.canMopWash, 'mop-wash');
  add(c.canMopDry, 'mop-dry');
  add(c.canHeatMopWater, 'heat-mop-water');
  add(c.hasDetergentReservoir, 'detergent');
  add(c.canCleanPerRoom, 'clean-per-room');
  add(c.supportsVirtualWalls, 'virtual-walls');
  add(c.supportsNoGoZones, 'no-go-zones');
  add(c.hasChildLock, 'child-lock');
  add(c.supportsMultiFloor, 'multi-floor');
  return tokens;
}

class VacuumCapabilitySet implements DeviceCapabilities {
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

/** Resolver that the BaseDevice accepts via BaseDeviceInput.capabilities. */
export class VacuumCapabilityResolver implements CapabilityResolver {
  resolve(model: string): DeviceCapabilities {
    return new VacuumCapabilitySet(model, tokensFor(getVacuumCapabilities(model)));
  }
}
