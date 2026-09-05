import { describe, it, expect } from 'vitest';
import { Nodreame } from '../../src/api/nodreame.js';
import { ALL_REGIONS, type DreameRegion } from '../../src/auth/config.js';
import {
  getVideoAccessToken,
  getAliyunAuthCode,
  getVideoFamilyId,
  getDeviceVideoProfile,
} from '../../src/video/index.js';

const enabled = process.env.DREAME_E2E === '1';
const username = process.env.DREAME_USERNAME ?? '';
const password = process.env.DREAME_PASSWORD ?? '';

function resolveRegion(raw: string): DreameRegion {
  const n = raw.trim().toLowerCase();
  if ((ALL_REGIONS as readonly string[]).includes(n)) {
    return n as DreameRegion;
  }
  return ({ gb: 'eu', it: 'eu', de: 'eu', us: 'us', cn: 'cn' } as Record<string, DreameRegion>)[n] ?? 'eu';
}

const region = resolveRegion(process.env.DREAME_COUNTRY ?? 'eu');

// Control-plane only — these calls do NOT open a stream or wake the camera.
describe.runIf(enabled)('e2e: video control-plane', () => {
  it('mints a video token, fetches the Aliyun authCode + familyId, and profiles devices', async () => {
    expect(username, 'set DREAME_USERNAME in .env').not.toBe('');
    expect(password, 'set DREAME_PASSWORD in .env').not.toBe('');

    const client = new Nodreame({ username, password, region });
    try {
      const session = await client.login();
      const devices = await client.discoverDevices();
      const base = { session, region };

      const token = await getVideoAccessToken(base);
      expect(token.token.length).toBeGreaterThan(8);
      expect(token.expiresAt).toBeGreaterThan(Date.now());

      const authCode = await getAliyunAuthCode(base);
      expect(authCode).toMatch(/^[0-9a-f]+$/i);
      expect(authCode.length).toBeGreaterThan(64);

      const familyId = await getVideoFamilyId({ ...base, videoToken: token.token });
      expect(familyId.length).toBeGreaterThan(0);

      for (const d of devices) {
        const p = await getDeviceVideoProfile({ ...base, did: d.deviceId });
        expect(p.did).toBe(d.deviceId);
        // A camera device advertises at least one supported vendor.
        if (p.videoCapable) {
          expect(p.supportedVendors.length).toBeGreaterThan(0);
        }
        // When provisioned on Aliyun, an iotId must be present.
        if (p.currentVendor === 'ali') {
          expect(p.iotId).not.toBeNull();
        }
      }
    } finally {
      await client.close();
    }
  }, 60_000);
});
