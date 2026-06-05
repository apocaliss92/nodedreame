import { describe, it, expect } from 'vitest';
import { Nodreame } from '../../src/api/nodreame.js';
import { VacuumDevice } from '../../src/models/vacuum/vacuum-device.js';
import { MowerDevice } from '../../src/models/mower/mower-device.js';
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

  it('discovers a VacuumDevice and reads its typed state (tolerating sleeping robots)', async () => {
    expect(username, 'set DREAME_USERNAME in .env').not.toBe('');
    expect(password, 'set DREAME_PASSWORD in .env').not.toBe('');

    const client = new Nodreame({
      username,
      password,
      region,
      fetchInitialValues: false,
    });

    const session = await client.login();
    expect(session.accessToken).toBeTruthy(); // truthiness only — never log the token
    expect(session.uid).toBeTruthy();

    const devices = await client.discoverDevices();
    // The account owns at least one dreame.vacuum.* robot.
    const vac = devices.find((d): d is VacuumDevice => d instanceof VacuumDevice);
    expect(vac, 'account should expose at least one VacuumDevice').toBeInstanceOf(VacuumDevice);
    const vacuumCount = devices.filter((d) => d instanceof VacuumDevice).length;
    console.log('[e2e] vacuum count:', vacuumCount, 'of', devices.length, 'devices');
    if (!vac) {
      await client.close();
      return;
    }

    // r2538z caps are ASSUMED from the r2532a sibling — assert SHAPE, not the
    // verified flag value.
    expect(typeof vac.vacuumCapabilities.canMop).toBe('boolean');
    expect(typeof vac.vacuumCapabilities.verified).toBe('boolean');

    // Seed the cache with a single live read of the vacuum's known props.
    // A sleeping/offline robot legitimately answers with a device-offline error
    // from the cloud — that is a valid end-to-end round-trip (the request
    // reached the cloud, the cloud reported the device unreachable). We accept
    // either path and NEVER assert a specific value.
    let online = false;
    try {
      const results = await vac.refreshProperties([...VacuumDevice.DEFAULT_PROPS]);
      expect(Array.isArray(results)).toBe(true);
      // Shape-only assertions: the typed getters either decode a number/enum or
      // return null; both are valid. No value assertions.
      expect(vac.battery === null || typeof vac.battery === 'number').toBe(true);
      expect(vac.status === null || typeof vac.status === 'number').toBe(true);
      expect(vac.suction === null || typeof vac.suction === 'number').toBe(true);
      expect(Array.isArray(vac.faults)).toBe(true);
      online = true;
      console.log('[e2e] vacuum typed-state read OK:', vac.model, '(props:', results.length, ')');
    } catch (err: unknown) {
      if (err instanceof DreameDeviceOfflineError) {
        console.log('[e2e] vacuum offline/sleeping; round-trip verified via offline path');
      } else {
        throw err;
      }
    }

    // Optional GUARDED safe command — only if the robot is actually online AND
    // the operator opts in (double-gated so a normal e2e run never beeps the
    // user's robots).
    if (online && process.env.DREAME_E2E_LOCATE === '1') {
      await vac.locate();
      console.log('[e2e] locate() dispatched');
    }

    await client.close();
  });

  it('discovers a MowerDevice and reads its typed state (tolerating an asleep mower)', async () => {
    expect(username, 'set DREAME_USERNAME in .env').not.toBe('');
    expect(password, 'set DREAME_PASSWORD in .env').not.toBe('');

    const client = new Nodreame({ username, password, region, fetchInitialValues: false });
    const session = await client.login();
    expect(session.accessToken).toBeTruthy(); // truthiness only — never log the token
    expect(session.uid).toBeTruthy();

    const devices = await client.discoverDevices();
    const mower = devices.find((d): d is MowerDevice => d instanceof MowerDevice);
    expect(mower, 'account should expose at least one MowerDevice').toBeInstanceOf(MowerDevice);
    console.log('[e2e] mower count:', devices.filter((d) => d instanceof MowerDevice).length);
    if (!mower) {
      await client.close();
      return;
    }

    // p2255 caps are ASSUMED — assert SHAPE, never the verified flag value.
    expect(typeof mower.mowerCapabilities.canMowZones).toBe('boolean');
    expect(typeof mower.mowerCapabilities.verified).toBe('boolean');

    try {
      const results = await mower.refreshProperties([...MowerDevice.DEFAULT_PROPS]);
      expect(Array.isArray(results)).toBe(true);
      // Shape-only: getters either decode a value/enum/object or return null.
      expect(mower.battery === null || typeof mower.battery === 'number').toBe(true);
      expect(mower.status === null || typeof mower.status === 'number').toBe(true);
      expect(mower.task === null || typeof mower.task === 'object').toBe(true);
      expect(mower.controlAction === null || typeof mower.controlAction === 'number').toBe(true);
      console.log('[e2e] mower typed-state read OK:', mower.model, '(props:', results.length, ')');
    } catch (err: unknown) {
      if (err instanceof DreameDeviceOfflineError) {
        console.log('[e2e] mower offline/sleeping; round-trip verified via offline path');
      } else {
        throw err;
      }
    }
    // NO destructive command is ever issued against the real mower.
    await client.close();
  });
});
