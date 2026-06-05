import { describe, it, expect } from 'vitest';
import {
  OAuthTokenResponseSchema,
  DeviceListResponseSchema,
  SendCommandResponseSchema,
  CachedPropsResponseSchema,
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

describe('CachedPropsResponseSchema', () => {
  it('parses a cloud-shadow response with data[] entries and unknown values', () => {
    const r = CachedPropsResponseSchema.parse({
      code: 0,
      msg: '操作成功',
      data: [
        { key: '2.1', value: '13', updateDate: 1780664532160 },
        { key: '3.1', value: 100 },
        { key: '2.2', value: true, extra: 'x' },
      ],
    });
    expect(r.code).toBe(0);
    expect(r.data?.[0]?.key).toBe('2.1');
    expect(r.data?.[0]?.value).toBe('13');
    expect(r.data?.[0]?.updateDate).toBe(1780664532160);
  });
  it('accepts an error response without data', () => {
    const r = CachedPropsResponseSchema.parse({ code: 10001, msg: 'bad keys' });
    expect(r.code).toBe(10001);
    expect(r.data).toBeUndefined();
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
