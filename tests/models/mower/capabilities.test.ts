import { describe, it, expect } from 'vitest';
import {
  getMowerCapabilities,
  MowerCapabilityResolver,
  MODEL_CAPABILITIES,
} from '../../../src/models/mower/capabilities.js';

describe('mower capabilities', () => {
  it('p2255 (A1) record exists; flags are ASSUMED (verified:false)', () => {
    const c = MODEL_CAPABILITIES['dreame.mower.p2255'];
    expect(c?.model).toBe('dreame.mower.p2255');
    expect(c?.verified).toBe(false);
    expect(c?.canMowZones).toBe(true);
    expect(c?.canMowEdges).toBe(true);
    expect(c?.canMowSpots).toBe(true);
    expect(c?.canResume).toBe(true);
    expect(c?.canSchedule).toBe(true);
  });

  it('records are frozen (immutable)', () => {
    const c = MODEL_CAPABILITIES['dreame.mower.p2255'];
    expect(Object.isFrozen(c)).toBe(true);
  });

  it('unknown model -> conservative fallback (verified:false, targeted off)', () => {
    const c = getMowerCapabilities('dreame.mower.zzz999');
    expect(c.verified).toBe(false);
    expect(c.canMowZones).toBe(false);
    expect(c.canResume).toBe(true); // resume is generic to the action surface
  });

  it('resolver exposes generic tokens', () => {
    const caps = new MowerCapabilityResolver().resolve('dreame.mower.p2255');
    expect(caps.has('mow-zones')).toBe(true);
    expect(caps.has('mow-edges')).toBe(true);
    expect(caps.has('resume')).toBe(true);
    expect(caps.list()).toContain('schedule');
    expect(caps.model).toBe('dreame.mower.p2255');
  });
});
