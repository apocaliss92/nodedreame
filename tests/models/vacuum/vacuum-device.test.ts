import { describe, it, expect } from 'vitest';
import { BaseDevice } from '../../../src/device/base-device.js';

describe('BaseDevice subclass surface contract (P3 prerequisite)', () => {
  it('exposes getProperty/setProperty/callAction as inheritable public methods', () => {
    const methods = Object.getOwnPropertyNames(BaseDevice.prototype);
    expect(methods).toContain('getProperty');
    expect(methods).toContain('setProperty');
    expect(methods).toContain('callAction');
    for (const name of ['getProperty', 'setProperty', 'callAction'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(BaseDevice.prototype, name);
      expect(typeof descriptor?.value).toBe('function');
    }
  });
});
