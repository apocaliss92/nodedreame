import { describe, it, expect } from 'vitest';
import { createHash, createCipheriv } from 'node:crypto';
import {
  hashPassword,
  buildRlcHeader,
  randomMqttClientId,
  randomRequestId,
} from '../../src/transport/crypto.js';

// Independently recompute the expected values here (a second implementation
// of the same spec) so the test is a real vector check, not a tautology.
const SALT = 'RAylYC%fmSKp7%Tq';
const KEY = 'EETjszu*XI5znHsI';

const expectedHash = (plain: string): string =>
  createHash('md5')
    .update(plain + SALT)
    .digest('hex');

const expectedRlc = (region: string, lang: string, country: string): string => {
  const cipher = createCipheriv('aes-128-ecb', Buffer.from(KEY, 'utf8'), null);
  return Buffer.concat([
    cipher.update(`${region}|${lang}|${country}`, 'utf8'),
    cipher.final(),
  ]).toString('hex');
};

describe('hashPassword', () => {
  it('returns salted lowercase md5 hex', () => {
    expect(hashPassword('hunter2')).toBe(expectedHash('hunter2'));
    expect(hashPassword('hunter2')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is stable / deterministic for the same input', () => {
    expect(hashPassword('abc')).toBe(hashPassword('abc'));
  });
});

describe('buildRlcHeader', () => {
  it('encrypts "<region>|<lang>|<country>" as AES-128-ECB hex', () => {
    expect(buildRlcHeader('eu', 'en', 'GB')).toBe(expectedRlc('eu', 'en', 'GB'));
    expect(buildRlcHeader('eu', 'en', 'GB')).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic (ECB, no IV)', () => {
    expect(buildRlcHeader('us', 'en', 'US')).toBe(buildRlcHeader('us', 'en', 'US'));
  });
});

describe('randomMqttClientId', () => {
  it('matches the p_<16 hex> format', () => {
    expect(randomMqttClientId()).toMatch(/^p_[0-9a-f]{16}$/);
  });
  it('is unique across calls', () => {
    expect(randomMqttClientId()).not.toBe(randomMqttClientId());
  });
});

describe('randomRequestId', () => {
  it('returns a positive 31-bit-safe integer', () => {
    for (let i = 0; i < 50; i += 1) {
      const id = randomRequestId();
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThanOrEqual(1);
      expect(id).toBeLessThanOrEqual(0x7fffffff);
    }
  });
});
