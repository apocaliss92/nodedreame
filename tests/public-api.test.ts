import { describe, it, expect } from 'vitest';
import * as api from '../src/index.js';

describe('public API surface (P1)', () => {
  it('still exports LIBRARY_NAME', () => {
    expect(api.LIBRARY_NAME).toBe('nodedreame');
  });

  it('exports the error classes', () => {
    expect(typeof api.DreameError).toBe('function');
    expect(typeof api.DreameAuthError).toBe('function');
    expect(typeof api.DreameApiError).toBe('function');
    expect(typeof api.DreameDeviceOfflineError).toBe('function');
    expect(typeof api.DreameTransportError).toBe('function');
  });
});

describe('public API surface (P2)', () => {
  it('exports the Nodreame facade', () => {
    expect(typeof api.Nodreame).toBe('function');
  });

  it('exports the BaseDevice handle', () => {
    expect(typeof api.BaseDevice).toBe('function');
  });

  it('exports the capability scaffold', () => {
    expect(typeof api.DefaultCapabilityResolver).toBe('function');
    expect(typeof api.resolveCapabilities).toBe('function');
  });

  it('does NOT leak transport internals (DreamePush is private)', () => {
    expect('DreamePush' in api).toBe(false);
  });
});
