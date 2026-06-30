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
  // The Dreame cloud's device-side correlation id is a NARROW integer field:
  // verified live on dreame.mower.p2255 that ids ≳ 1e8 make sendCommand return
  // code 80001 "device offline" (the oversized id never round-trips), while ids
  // up to 2^24 work. A 31-bit random id therefore broke EVERY mower command, so
  // the id MUST stay small and is a monotonic counter wrapping under 0xffffff.
  const MAX = 0xffffff;

  it('returns small, monotonically increasing ids capped under the cloud ceiling', () => {
    let prev = randomRequestId();
    expect(Number.isInteger(prev)).toBe(true);
    expect(prev).toBeGreaterThanOrEqual(1);
    expect(prev).toBeLessThanOrEqual(MAX);
    for (let i = 0; i < 500; i += 1) {
      const id = randomRequestId();
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThanOrEqual(1);
      expect(id).toBeLessThanOrEqual(MAX);
      // strictly increments, except a single wrap back to 1 at the ceiling
      expect(id === prev + 1 || id === 1).toBe(true);
      prev = id;
    }
  });
});
