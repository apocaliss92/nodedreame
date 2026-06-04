import { describe, it, expect } from 'vitest';
import {
  DreameError,
  DreameAuthError,
  DreameApiError,
  DreameDeviceOfflineError,
  DreameTransportError,
} from '../../src/transport/errors.js';

describe('error hierarchy', () => {
  it('DreameError carries a message and optional cause', () => {
    const cause = new Error('root');
    const e = new DreameError('boom', cause);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('DreameError');
    expect(e.message).toBe('boom');
    expect(e.cause).toBe(cause);
  });

  it('DreameAuthError extends DreameError and carries status', () => {
    const e = new DreameAuthError('bad creds', 401);
    expect(e).toBeInstanceOf(DreameError);
    expect(e.name).toBe('DreameAuthError');
    expect(e.status).toBe(401);
  });

  it('DreameApiError carries status + body', () => {
    const e = new DreameApiError('nope', 500, { code: 5 });
    expect(e).toBeInstanceOf(DreameError);
    expect(e.status).toBe(500);
    expect(e.body).toEqual({ code: 5 });
  });

  it('DreameDeviceOfflineError extends DreameApiError', () => {
    const e = new DreameDeviceOfflineError('offline', 200, { code: 80001 });
    expect(e).toBeInstanceOf(DreameApiError);
    expect(e.name).toBe('DreameDeviceOfflineError');
    expect(e.status).toBe(200);
  });

  it('DreameTransportError extends DreameError', () => {
    const e = new DreameTransportError('net down');
    expect(e).toBeInstanceOf(DreameError);
    expect(e.name).toBe('DreameTransportError');
  });
});
