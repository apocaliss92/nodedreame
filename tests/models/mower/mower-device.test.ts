import { describe, it, expect } from 'vitest';
import { BaseDevice } from '../../../src/device/base-device.js';
import { MowerDevice } from '../../../src/models/mower/mower-device.js';
import {
  MowerStatus,
  MowerChargingStatus,
  MowerControlAction,
  MowerTaskStatus,
  MowerFault,
} from '../../../src/models/mower/enums.js';
import type { BaseDeviceDeps, PushLike } from '../../../src/device/base-device.js';
import type { DreameDevice, DreameSession, PropertyResult } from '../../../src/cloud/types.js';

function fakeSession(): DreameSession {
  return { accessToken: 't', uid: 'u', expiresAt: Date.now() + 1e6, region: 'eu' };
}
function fakeDevice(model = 'dreame.mower.p2255'): DreameDevice {
  return { did: 'm1', model, name: 'Mowy', online: true, raw: {} };
}
function fakePush(): PushLike {
  const fp: PushLike = {
    on: () => fp,
    open: () => Promise.resolve(),
    close: () => Promise.resolve(),
    refreshSession: () => Promise.resolve(),
  };
  return fp;
}
function depsReturning(results: PropertyResult[]): BaseDeviceDeps {
  return {
    createPush: () => fakePush(),
    getProperties: () => Promise.resolve(results),
    getCachedProperties: () => Promise.resolve(results),
    setProperties: () => Promise.resolve([]),
    callAction: () => Promise.resolve({}),
  };
}

describe('MowerDevice.refreshFromCache', () => {
  it('seeds the cache from the cloud shadow so typed getters read cached values', async () => {
    const cached: PropertyResult[] = [
      { siid: 2, piid: 1, value: 1, code: 0 }, // STATUS = Mowing
      { siid: 3, piid: 1, value: 64, code: 0 }, // battery
      { siid: 3, piid: 2, value: 1, code: 0 }, // charging = Charging
    ];
    const calls: ('live' | 'cache')[] = [];
    const deps: BaseDeviceDeps = {
      createPush: () => fakePush(),
      getProperties: () => {
        calls.push('live');
        return Promise.resolve([] as PropertyResult[]);
      },
      getCachedProperties: () => {
        calls.push('cache');
        return Promise.resolve(cached);
      },
      setProperties: () => Promise.resolve([]),
      callAction: () => Promise.resolve({}),
    };
    const m = new MowerDevice({
      device: fakeDevice(),
      region: 'eu',
      sessionRef: fakeSession,
      deps,
      fetchInitialValues: false,
    });
    await m.start();
    await m.refreshFromCache();
    expect(calls).toEqual(['cache']);
    expect(m.status).toBe(MowerStatus.Mowing);
    expect(m.battery).toBe(64);
    expect(m.charging).toBe(MowerChargingStatus.Charging);
  });
});

describe('MowerDevice is a BaseDevice', () => {
  it('extends BaseDevice', () => {
    const m = new MowerDevice({
      device: fakeDevice(),
      region: 'eu',
      sessionRef: fakeSession,
      deps: depsReturning([]),
      fetchInitialValues: false,
    });
    expect(m).toBeInstanceOf(BaseDevice);
  });
});

describe('MowerDevice typed state getters', () => {
  it('decodes seeded properties into typed state', async () => {
    const results: PropertyResult[] = [
      { siid: 2, piid: 1, value: 1, code: 0 }, // STATUS = Mowing
      { siid: 3, piid: 1, value: 73, code: 0 }, // battery
      { siid: 3, piid: 2, value: 2, code: 0 }, // charging = NotCharging
      { siid: 5, piid: 104, value: 7, code: 0 }, // task status = SpotIncomplete
      {
        siid: 2,
        piid: 50,
        value: { t: 'TASK', d: { exe: true, o: 67, status: true, region_id: [1] } },
        code: 0,
      },
      {
        siid: 2,
        piid: 56,
        value: {
          status: [
            [1, -1],
            [3, 0],
          ],
        },
        code: 0,
      },
    ];
    const m = new MowerDevice({
      device: fakeDevice(),
      region: 'eu',
      sessionRef: fakeSession,
      deps: depsReturning(results),
      fetchInitialValues: false,
    });
    await m.start();
    await m.refreshProperties([...MowerDevice.DEFAULT_PROPS]);

    expect(m.status).toBe(MowerStatus.Mowing);
    expect(m.statusRaw).toBe(1);
    expect(m.battery).toBe(73);
    expect(m.charging).toBe(MowerChargingStatus.NotCharging);
    expect(m.isDocked).toBe(false);
    expect(m.isMowing).toBe(true);
    expect(m.taskStatusRaw).toBe(7);
    expect(m.coverageTargetPct).toBe(67);
    expect(m.task?.regionId).toEqual([1]);
    expect(m.controlAction).toBe(MowerControlAction.Continue);
    await m.close();
  });

  it('returns null typed-state for unseeded / out-of-enum values', async () => {
    const m = new MowerDevice({
      device: fakeDevice(),
      region: 'eu',
      sessionRef: fakeSession,
      deps: depsReturning([{ siid: 2, piid: 1, value: 250, code: 0 }]),
      fetchInitialValues: false,
    });
    await m.start();
    expect(m.battery).toBeNull();
    expect(m.task).toBeNull();
    expect(m.controlAction).toBeNull();
    await m.refreshProperties([{ siid: 2, piid: 1 }]);
    expect(m.statusRaw).toBe(250);
    expect(m.status).toBeNull(); // 250 not a MowerStatus member
    await m.close();
  });

  it('isDocked is true for Charging/ChargingComplete', async () => {
    const m = new MowerDevice({
      device: fakeDevice(),
      region: 'eu',
      sessionRef: fakeSession,
      deps: depsReturning([{ siid: 2, piid: 1, value: 6, code: 0 }]),
      fetchInitialValues: false,
    });
    await m.start();
    await m.refreshProperties([{ siid: 2, piid: 1 }]);
    expect(m.isDocked).toBe(true);
    expect(m.isMowing).toBe(false);
    await m.close();
  });

  it('exposes the rich mower capabilities + generic tokens', () => {
    const m = new MowerDevice({
      device: fakeDevice(),
      region: 'eu',
      sessionRef: fakeSession,
      deps: depsReturning([]),
      fetchInitialValues: false,
    });
    expect(m.mowerCapabilities.canMowZones).toBe(true);
    expect(m.mowerCapabilities.verified).toBe(false); // p2255 assumed
    expect(m.capabilities.has('mow-zones')).toBe(true);
    expect(m.controlStatus).toBeNull();
    expect(m.chargingRaw).toBeNull();
    expect(m.charging).toBeNull();
  });

  it('decodes taskStatus to the enum when documented, raw otherwise', async () => {
    const m = new MowerDevice({
      device: fakeDevice(),
      region: 'eu',
      sessionRef: fakeSession,
      deps: depsReturning([{ siid: 5, piid: 104, value: 7, code: 0 }]),
      fetchInitialValues: false,
    });
    await m.start();
    await m.refreshProperties([{ siid: 5, piid: 104 }]);
    expect(m.taskStatusRaw).toBe(7);
    expect(m.taskStatus).toBe(MowerTaskStatus.SpotIncomplete);
    await m.close();
  });

  it('taskStatus returns null for codes the donor leaves "Unknown" (raw preserved)', async () => {
    // Donor marks 2/3/10/13 as "Unknown task status: N" — they MUST stay raw.
    const m = new MowerDevice({
      device: fakeDevice(),
      region: 'eu',
      sessionRef: fakeSession,
      deps: depsReturning([{ siid: 5, piid: 104, value: 10, code: 0 }]),
      fetchInitialValues: false,
    });
    await m.start();
    await m.refreshProperties([{ siid: 5, piid: 104 }]);
    expect(m.taskStatusRaw).toBe(10);
    expect(m.taskStatus).toBeNull();
    await m.close();
  });

  it('decodes the device-code fault (2:2) to MowerFault, raw preserved', async () => {
    const m = new MowerDevice({
      device: fakeDevice(),
      region: 'eu',
      sessionRef: fakeSession,
      deps: depsReturning([{ siid: 2, piid: 2, value: 23, code: 0 }]),
      fetchInitialValues: false,
    });
    await m.start();
    await m.refreshProperties([{ siid: 2, piid: 2 }]);
    expect(m.faultRaw).toBe(23);
    expect(m.fault).toBe(MowerFault.EmergencyStop);
    await m.close();
  });

  it('fault returns null for an undocumented code (honest raw fallback)', async () => {
    const m = new MowerDevice({
      device: fakeDevice(),
      region: 'eu',
      sessionRef: fakeSession,
      deps: depsReturning([{ siid: 2, piid: 2, value: 999, code: 0 }]),
      fetchInitialValues: false,
    });
    await m.start();
    await m.refreshProperties([{ siid: 2, piid: 2 }]);
    expect(m.faultRaw).toBe(999);
    expect(m.fault).toBeNull();
    await m.close();
  });
});
