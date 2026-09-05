import { describe, it, expect } from 'vitest';
import { Nodreame } from '../../src/api/nodreame.js';
import { getDeviceVideoProfile } from '../../src/video/index.js';
import { DreameVideoSession } from '../../src/video/aliyun/session.js';

const enabled = process.env.DREAME_E2E === '1';
const username = process.env.DREAME_USERNAME ?? '';
const password = process.env.DREAME_PASSWORD ?? '';

// Full AUTONOMOUS Aliyun LinkVisual chain: Dreame authCode -> OA login -> IoT
// session -> stream/query. Requires a camera device streaming (open in app).
describe.runIf(enabled)('e2e: Aliyun media plane (autonomous iotToken)', () => {
  it('mints an iotToken from scratch and gets a plain relay URL', async () => {
    const client = new Nodreame({ username, password, region: 'eu' });
    try {
      const session = await client.login();
      const devices = await client.discoverDevices();

      const video = new DreameVideoSession({ session, region: 'eu' });
      const iot = await video.ensureIotSession();
      expect(iot.iotToken.length).toBeGreaterThan(8);
      expect(iot.expiresAt).toBeGreaterThan(Date.now());
      expect(video.regionId).toBe('eu-central-1');

      // find an Aliyun device that currently has an iotId
      let iotId: string | null = null;
      for (const d of devices) {
        const p = await getDeviceVideoProfile({ session, region: 'eu', did: d.deviceId });
        if (p.iotId) { iotId = p.iotId; break; }
      }
      if (!iotId) {
        console.warn('no device with an Aliyun iotId; skipping stream/query');
        return;
      }

      const stream = await video.getStreamInfo(iotId, { encrypted: false });
      console.log('relayUrl present:', Boolean(stream.relayUrl), '| decryptKey:', stream.relayDecryptKey);
      // relayUrl is only present when the device is actively streaming
      if (stream.relayUrl) {
        expect(stream.relayUrl).toContain('rtmp://');
        expect(stream.relayDecryptKey).toBeNull(); // plain when relayEncrypted:false
      }
    } finally {
      await client.close();
    }
  }, 60_000);
});
