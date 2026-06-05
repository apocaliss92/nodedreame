import { describe, it, expect } from 'vitest';
import { redact, REDACTED } from '../../src/diagnostics/redact.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Cast-free narrow of a `redact()` result to an indexable record (or throw). */
function asRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error('expected a plain object');
  }
  return value;
}

describe('redact', () => {
  it('replaces every listed identity/secret field with the placeholder', () => {
    const input = {
      did: '123456789',
      uid: 'u-987',
      accessToken: 'eyJabc.secret',
      refreshToken: 'r-secret',
      mac: 'AA:BB:CC:DD:EE:FF',
      serialNumber: 'SN-DEADBEEF',
      email: 'someone@example.com',
      authorization: 'Bearer xyz',
      password: 'hunter2',
    };
    const out = asRecord(redact(input));
    for (const k of Object.keys(input)) {
      expect(out[k]).toBe(REDACTED);
    }
  });

  it('replaces location/PII fields (gps, coordinates, ssid, ip, rooms, custom name)', () => {
    const input = {
      gps: [45.123, 9.456],
      latitude: 45.1,
      longitude: 9.4,
      ssid: 'MyHomeWifi',
      ip: '192.168.1.42',
      localIp: '10.0.0.5',
      bindDomain: 'broker-eu.example.com',
      customName: 'Gianluca living room',
      deviceName: 'My Robot',
      rooms: { '1': 'Bedroom', '2': 'Kitchen' },
      map_info: 'base64-binary-blob',
    };
    const out = asRecord(redact(input));
    expect(out['gps']).toBe(REDACTED);
    expect(out['latitude']).toBe(REDACTED);
    expect(out['longitude']).toBe(REDACTED);
    expect(out['ssid']).toBe(REDACTED);
    expect(out['ip']).toBe(REDACTED);
    expect(out['localIp']).toBe(REDACTED);
    expect(out['bindDomain']).toBe(REDACTED);
    expect(out['customName']).toBe(REDACTED);
    expect(out['deviceName']).toBe(REDACTED);
    expect(out['rooms']).toBe(REDACTED);
    expect(out['map_info']).toBe(REDACTED);
  });

  it('recurses into nested objects and arrays, scrubbing matched fields at any depth', () => {
    const input = {
      device: { model: 'dreame.vacuum.r2532a', did: 'secret-did', firmware: '4.3.9' },
      list: [
        { uid: 'a', value: 5 },
        { uid: 'b', value: 6 },
      ],
    };
    const out = asRecord(redact(input));
    const device = asRecord(out['device']);
    expect(device['model']).toBe('dreame.vacuum.r2532a'); // kept
    expect(device['firmware']).toBe('4.3.9'); // kept
    expect(device['did']).toBe(REDACTED);
    const list = out['list'];
    if (!Array.isArray(list)) throw new Error('expected array');
    const first = asRecord(list[0]);
    expect(first['uid']).toBe(REDACTED);
    expect(first['value']).toBe(5); // kept
  });

  it('keeps non-sensitive scalars/keys (model, firmware, region, property keys + values, enum names)', () => {
    const input = {
      model: 'dreame.mower.p2255',
      firmware: '1.2.3',
      region: 'eu',
      '2.1': 6,
      enum: 'MiotState.Charging',
      values: [1, 2, 3],
      unmapped: [99],
    };
    const out = redact(input);
    expect(out).toEqual(input); // nothing matched → structurally equal (but a NEW object)
    expect(out).not.toBe(input); // immutability: new top-level object
  });

  it('does NOT mutate the input', () => {
    const input = { did: 'x', nested: { uid: 'y' } };
    const snapshot = JSON.stringify(input);
    redact(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('passes scalars through unchanged', () => {
    expect(redact(5)).toBe(5);
    expect(redact('hello')).toBe('hello');
    expect(redact(null)).toBe(null);
    expect(redact(true)).toBe(true);
  });
});
