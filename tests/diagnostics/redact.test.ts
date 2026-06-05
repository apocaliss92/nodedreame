import { describe, it, expect } from 'vitest';
import { redact, REDACTED, sanitizeStringValue } from '../../src/diagnostics/redact.js';

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

  // FIX 1 — the real `did` leaks under the key `deviceId` in raw frames; the
  // `did` fragment does NOT match `deviceid` (substring `did` ∉ `d-e-v-i-c-e-i-d`).
  it('scrubs the real deviceId key (any casing) — FIX 1', () => {
    const input = { deviceId: 'REAL-DID-123456789', deviceID: 'X', DEVICEID: 'Y' };
    const out = asRecord(redact(input));
    expect(out['deviceId']).toBe(REDACTED);
    expect(out['deviceID']).toBe(REDACTED);
    expect(out['DEVICEID']).toBe(REDACTED);
  });

  it('does NOT over-match benign keys (siid/piid/eiid/model/region/type/value/count) — FIX 1', () => {
    const input = {
      siid: 2,
      piid: 1,
      eiid: 4,
      model: 'dreame.vacuum.r2532a',
      region: 'eu',
      type: 'vacuum',
      value: 6,
      count: 3,
    };
    const out = redact(input);
    expect(out).toEqual(input);
  });

  // FIX 3 — room/zone/map names are user-set PII.
  it('scrubs room/zone/map name keys (any casing) — FIX 3', () => {
    const input = {
      roomName: 'Bedroom',
      zone_name: 'Garden',
      zoneName: 'Garden',
      map_name: 'Ground floor',
      mapName: 'Ground floor',
    };
    const out = asRecord(redact(input));
    expect(out['roomName']).toBe(REDACTED);
    expect(out['zone_name']).toBe(REDACTED);
    expect(out['zoneName']).toBe(REDACTED);
    expect(out['map_name']).toBe(REDACTED);
    expect(out['mapName']).toBe(REDACTED);
  });
});

// FIX 2 — string VALUES carrying secrets/signed-URLs/OSS-paths are not scrubbed
// by key (they live under numeric keys like "6.3"). A conservative value
// sanitizer replaces the whole string only when it matches a risky pattern.
describe('sanitizeStringValue (FIX 2)', () => {
  it('redacts risky values', () => {
    expect(sanitizeStringValue('ali_dreame/U/D/0')).toBe(REDACTED);
    expect(sanitizeStringValue('ali_dreame/UID123/DID456/0')).toBe(REDACTED);
    expect(sanitizeStringValue('https://x.oss.com/a?token=abc')).toBe(REDACTED);
    expect(sanitizeStringValue('http://broker.example.com/path')).toBe(REDACTED);
    expect(sanitizeStringValue('mqtts://host/topic')).toBe(REDACTED);
    // 40-char hex token (a long opaque run ≥32)
    expect(sanitizeStringValue('a'.repeat(40))).toBe(REDACTED);
    expect(sanitizeStringValue('0123456789abcdef0123456789abcdef0123abcd')).toBe(REDACTED);
    // query-param secrets
    expect(sanitizeStringValue('did=12345')).toBe(REDACTED);
    expect(sanitizeStringValue('uid=abc')).toBe(REDACTED);
    expect(sanitizeStringValue('token=abc')).toBe(REDACTED);
    expect(sanitizeStringValue('x-access-key:abc')).toBe(REDACTED);
  });

  it('preserves benign diagnostic values', () => {
    expect(sanitizeStringValue('START')).toBe('START');
    expect(sanitizeStringValue('SweepAndMop')).toBe('SweepAndMop');
    expect(sanitizeStringValue('18,107')).toBe('18,107');
    expect(sanitizeStringValue('13')).toBe('13');
    expect(sanitizeStringValue('13,14')).toBe('13,14');
    expect(sanitizeStringValue('{"a":1,"b":2}')).toBe('{"a":1,"b":2}');
    expect(sanitizeStringValue('MiotState.Charging')).toBe('MiotState.Charging');
    expect(sanitizeStringValue('')).toBe('');
  });

  it('redact applies the value sanitizer to every string scalar in the tree', () => {
    const input = {
      '6.3': 'ali_dreame/UID123/DID456/0',
      '2.1': 'START',
      nested: { url: 'https://x.oss.com/a?token=abc', enum: 'SweepAndMop' },
      list: ['18,107', 'ali_dreame/A/B/0'],
    };
    const out = asRecord(redact(input));
    expect(out['6.3']).toBe(REDACTED);
    expect(out['2.1']).toBe('START');
    const nested = asRecord(out['nested']);
    expect(nested['url']).toBe(REDACTED);
    expect(nested['enum']).toBe('SweepAndMop');
    const list = out['list'];
    if (!Array.isArray(list)) throw new Error('expected array');
    expect(list[0]).toBe('18,107');
    expect(list[1]).toBe(REDACTED);
  });

  it('end-to-end: a propertyChanged-style OSS value leaks neither uid nor did', () => {
    const input = { '6.3': 'ali_dreame/UID123/DID456/0' };
    const json = JSON.stringify(redact(input));
    expect(json).not.toContain('UID123');
    expect(json).not.toContain('DID456');
    expect(json).toContain(REDACTED);
  });
});
