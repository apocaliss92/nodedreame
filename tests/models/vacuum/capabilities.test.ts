import { describe, it, expect } from 'vitest';
import {
  getVacuumCapabilities,
  VacuumCapabilityResolver,
  MODEL_CAPABILITIES,
} from '../../../src/models/vacuum/capabilities.js';
import { SuctionLevel, WaterVolume } from '../../../src/models/vacuum/enums.js';

describe('vacuum capabilities', () => {
  it('r2532a is the verified X50 full-feature record', () => {
    const c = getVacuumCapabilities('dreame.vacuum.r2532a');
    expect(c.verified).toBe(true);
    expect(c.canMop).toBe(true);
    expect(c.canCleanPerRoom).toBe(true);
    expect(c.supportedSuctionLevels).toEqual([
      SuctionLevel.Quiet,
      SuctionLevel.Standard,
      SuctionLevel.Intense,
      SuctionLevel.Max,
    ]);
    expect(c.supportedWaterVolumes).toEqual([
      WaterVolume.Low,
      WaterVolume.Medium,
      WaterVolume.High,
    ]);
  });

  it("r2538z mirrors r2532a's feature subset but is marked unverified", () => {
    const c = getVacuumCapabilities('dreame.vacuum.r2538z');
    expect(c.verified).toBe(false);
    expect(c.canMop).toBe(true);
    expect(c.canCleanPerRoom).toBe(true);
    expect(c.canAutoEmpty).toBe(true);
    expect(MODEL_CAPABILITIES['dreame.vacuum.r2538z']).toBeDefined();
  });

  it('unknown models fall back to conservative defaults (verified:false)', () => {
    const c = getVacuumCapabilities('dreame.vacuum.zzz999');
    expect(c.verified).toBe(false);
    expect(c.canMop).toBe(false);
    expect(c.canCleanPerRoom).toBe(false);
    // suction/water still default-populated (most of the generation has them)
    expect(c.supportedSuctionLevels.length).toBe(4);
  });

  it('resolver produces a generic DeviceCapabilities token set for the base', () => {
    const caps = new VacuumCapabilityResolver().resolve('dreame.vacuum.r2538z');
    expect(caps.model).toBe('dreame.vacuum.r2538z');
    expect(caps.has('mop')).toBe(true);
    expect(caps.has('clean-per-room')).toBe(true);
    expect(caps.has('nonexistent-token')).toBe(false);
    expect(caps.list()).toContain('auto-empty');
  });

  it('rich records are frozen (shared by reference, must not mutate)', () => {
    const c = getVacuumCapabilities('dreame.vacuum.r2532a');
    expect(Object.isFrozen(c)).toBe(true);
  });
});
