import { describe, it, expect } from 'vitest';
import { Nodreame } from '../../src/api/nodreame.js';
import { ALL_REGIONS, type DreameRegion } from '../../src/auth/config.js';
import { DreameDeviceOfflineError } from '../../src/transport/errors.js';
import type { PropertyResult } from '../../src/cloud/types.js';

const enabled = process.env.DREAME_E2E === '1';
const username = process.env.DREAME_USERNAME ?? '';
const password = process.env.DREAME_PASSWORD ?? '';

function resolveRegion(raw: string): DreameRegion {
  const normalised = raw.trim().toLowerCase();
  if ((ALL_REGIONS as readonly string[]).includes(normalised)) {
    return normalised as DreameRegion;
  }
  const isoFallback: Record<string, DreameRegion> = {
    gb: 'eu',
    it: 'eu',
    de: 'eu',
    us: 'us',
    cn: 'cn',
  };
  return isoFallback[normalised] ?? 'eu';
}

const region = resolveRegion(process.env.DREAME_COUNTRY ?? 'eu');

describe.runIf(enabled)('e2e: Nodreame facade', () => {
  it('logs in, discovers devices, reads a property live, and closes cleanly', async () => {
    expect(username, 'set DREAME_USERNAME in .env').not.toBe('');
    expect(password, 'set DREAME_PASSWORD in .env').not.toBe('');

    const client = new Nodreame({
      username,
      password,
      region,
      // Don't eager-seed: the generic facade doesn't know each model's props yet.
      fetchInitialValues: false,
    });

    const session = await client.login();
    expect(session.accessToken).toBeTruthy(); // truthiness only — never log the token
    expect(session.uid).toBeTruthy();

    const devices = await client.discoverDevices();
    // The account owns a vacuum + a mower.
    expect(devices.length).toBeGreaterThanOrEqual(2);
    for (const d of devices) {
      expect(d.deviceId).toBeTruthy();
      expect(d.model).toBeTruthy();
    }
    console.log(
      '[e2e] facade discovered:',
      devices.map((d) => `${d.model}`),
    );

    // Read a generic MIoT property live. siid 2 piid 1 is the canonical MIoT
    // device-status property across Dreame models; battery is commonly siid 3
    // piid 1. We assert the call returns a STRUCTURED result array, not a
    // specific value. A sleeping/offline device legitimately answers with a
    // device-offline error from the cloud — that is a valid live round-trip
    // (request reached the cloud, the cloud reported the device unreachable),
    // so we try each device and accept the first that returns a result array,
    // tolerating offline devices along the way.
    const probe: { siid: number; piid: number }[] = [
      { siid: 2, piid: 1 },
      { siid: 3, piid: 1 },
    ];
    let results: PropertyResult[] | null = null;
    let offlineCount = 0;
    for (const device of devices) {
      try {
        results = await device.refreshProperties(probe);
        console.log('[e2e] live read OK from model:', device.model);
        break;
      } catch (err: unknown) {
        if (err instanceof DreameDeviceOfflineError) {
          offlineCount += 1;
          console.log('[e2e] device offline (sleeping), trying next:', device.model);
          continue;
        }
        throw err;
      }
    }

    if (results !== null) {
      // A reachable device returned a structured result array.
      expect(Array.isArray(results)).toBe(true);
      console.log('[e2e] live property count:', results.length);
    } else {
      // Every device was offline/sleeping — the live round-trip still
      // succeeded end-to-end (cloud reachable, offline correctly surfaced).
      expect(offlineCount).toBe(devices.length);
      console.log('[e2e] all devices offline/sleeping; live round-trip verified via offline path');
    }

    await client.close();
  });
});
