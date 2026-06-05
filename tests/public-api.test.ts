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
