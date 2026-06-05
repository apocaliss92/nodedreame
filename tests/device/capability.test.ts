import { describe, it, expect } from 'vitest';
import { DefaultCapabilityResolver, resolveCapabilities } from '../../src/device/capability.js';

describe('capability resolver', () => {
  it('default resolver returns a model with no known capabilities', () => {
    const caps = resolveCapabilities('dreame.vacuum.r2532a');
    expect(caps.model).toBe('dreame.vacuum.r2532a');
    expect(caps.has('clean')).toBe(false);
    expect([...caps.list()]).toEqual([]);
  });

  it('DefaultCapabilityResolver is usable directly and is stateless', () => {
    const resolver = new DefaultCapabilityResolver();
    const a = resolver.resolve('dreame.mower.p2255');
    const b = resolver.resolve('dreame.mower.p2255');
    expect(a.model).toBe('dreame.mower.p2255');
    // Stateless: distinct instances, equal content.
    expect(a.has('mow')).toBe(false);
    expect(b.has('mow')).toBe(false);
  });
});
