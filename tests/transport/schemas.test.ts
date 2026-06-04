import { describe, it, expect } from 'vitest';
import {
  OAuthTokenResponseSchema,
  DeviceListResponseSchema,
  SendCommandResponseSchema,
  RawMqttEventSchema,
} from '../../src/transport/schemas.js';

describe('OAuthTokenResponseSchema', () => {
  it('accepts a real token response and keeps unknown keys', () => {
    const r = OAuthTokenResponseSchema.parse({
      access_token: 'a',
      refresh_token: 'r',
      expires_in: 7200,
      uid: 12345,
      region: 'eu',
      surprise: true,
    });
    expect(r.access_token).toBe('a');
    expect(r.uid).toBe(12345);
  });
  it('accepts an OAuth error response (no access_token)', () => {
    const r = OAuthTokenResponseSchema.parse({ error: 'invalid_grant' });
    expect(r.error).toBe('invalid_grant');
  });
  it('rejects a wholly non-object body', () => {
    expect(() => OAuthTokenResponseSchema.parse('nope')).toThrow();
  });
});

describe('DeviceListResponseSchema', () => {
  it('parses nested page.records', () => {
    const r = DeviceListResponseSchema.parse({
      code: 0,
      data: { page: { records: [{ did: 'd', model: 'm', bindDomain: 'b' }] } },
    });
    expect(r.data?.page?.records?.[0]?.did).toBe('d');
  });
});

describe('SendCommandResponseSchema', () => {
  it('parses a property result array under data.result', () => {
    const r = SendCommandResponseSchema.parse({
      code: 0,
      data: { result: [{ siid: 2, piid: 1, value: 13, code: 0 }] },
    });
    expect(Array.isArray(r.data?.result)).toBe(true);
  });
});

describe('RawMqttEventSchema', () => {
  it('parses a properties_changed envelope', () => {
    const r = RawMqttEventSchema.parse({
      id: 92,
      did: 'd',
      data: {
        id: 92,
        method: 'properties_changed',
        params: [{ did: 'd', siid: 2, piid: 6, value: 1 }],
      },
    });
    expect(r.data?.method).toBe('properties_changed');
  });
  it('rejects malformed (non-object) payloads', () => {
    expect(() => RawMqttEventSchema.parse(42)).toThrow();
  });
});
