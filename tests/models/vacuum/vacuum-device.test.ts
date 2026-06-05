import { describe, it, expect } from 'vitest';
import { BaseDevice } from '../../../src/device/base-device.js';
import { VacuumDevice } from '../../../src/models/vacuum/vacuum-device.js';
import {
  MiotState,
  SuctionLevel,
  WaterVolume,
  ChargingStatus,
  CleaningMode,
} from '../../../src/models/vacuum/enums.js';
import type { BaseDeviceDeps, PushLike } from '../../../src/device/base-device.js';
import type { DreameDevice, DreameSession, PropertyResult } from '../../../src/cloud/types.js';

describe('BaseDevice subclass surface contract (P3 prerequisite)', () => {
  it('exposes getProperty/setProperty/callAction as inheritable public methods', () => {
    const methods = Object.getOwnPropertyNames(BaseDevice.prototype);
    expect(methods).toContain('getProperty');
    expect(methods).toContain('setProperty');
    expect(methods).toContain('callAction');
    for (const name of ['getProperty', 'setProperty', 'callAction'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(BaseDevice.prototype, name);
      expect(typeof descriptor?.value).toBe('function');
    }
  });
});

function fakeSession(): DreameSession {
  return { accessToken: 't', uid: 'u', expiresAt: Date.now() + 1e6, region: 'eu' };
}

function fakeDevice(model = 'dreame.vacuum.r2538z'): DreameDevice {
  return { did: 'd1', model, name: 'Robi', online: true, raw: {} };
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

// Build deps whose getProperties returns a fixed PropertyResult[] (seeds the
// cache via refreshProperties). No banned casts; the closures are exactly typed.
function depsReturning(results: PropertyResult[]): BaseDeviceDeps {
  return {
    createPush: () => fakePush(),
    getProperties: () => Promise.resolve(results),
    getCachedProperties: () => Promise.resolve(results),
    setProperties: () => Promise.resolve([]),
    callAction: () => Promise.resolve({}),
  };
}

describe('VacuumDevice.refreshFromCache', () => {
  it('seeds the cache from the cloud shadow so typed getters read cached values', async () => {
    const cached: PropertyResult[] = [
      { siid: 2, piid: 1, value: 6, code: 0 }, // STATE = Charging
      { siid: 3, piid: 1, value: 100, code: 0 }, // battery
      { siid: 4, piid: 4, value: 2, code: 0 }, // suction = Intense
      { siid: 4, piid: 5, value: 1, code: 0 }, // water = Low
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
    const v = new VacuumDevice({
      device: fakeDevice(),
      region: 'eu',
      sessionRef: fakeSession,
      deps,
      fetchInitialValues: false,
    });
    await v.start();
    await v.refreshFromCache();
    // Only the cached endpoint was hit (never the waking get_properties path).
    expect(calls).toEqual(['cache']);
    expect(v.status).toBe(MiotState.Charging);
    expect(v.battery).toBe(100);
    expect(v.suction).toBe(SuctionLevel.Intense);
    expect(v.water).toBe(WaterVolume.Low);
  });
});

describe('VacuumDevice state getters', () => {
  it('decodes seeded properties into typed state', async () => {
    const results: PropertyResult[] = [
      { siid: 2, piid: 1, value: 6, code: 0 }, // STATE = Charging
      { siid: 2, piid: 2, value: 0, code: 0 }, // ERROR = Clear
      { siid: 4, piid: 18, value: '18,107', code: 0 }, // FAULTS
      { siid: 3, piid: 1, value: 87, code: 0 }, // battery
      { siid: 3, piid: 2, value: 1, code: 0 }, // charging = Charging
      { siid: 4, piid: 4, value: 2, code: 0 }, // suction = Intense
      { siid: 4, piid: 5, value: 1, code: 0 }, // water = Low
      { siid: 2, piid: 6, value: 2, code: 0 }, // clean-mode-setting = SweepAndMop
      { siid: 4, piid: 63, value: 42, code: 0 }, // progress
    ];
    const v = new VacuumDevice({
      device: fakeDevice(),
      region: 'eu',
      sessionRef: fakeSession,
      deps: depsReturning(results),
      fetchInitialValues: false,
    });
    await v.start();
    await v.refreshProperties([
      { siid: 2, piid: 1 },
      { siid: 2, piid: 2 },
      { siid: 4, piid: 18 },
      { siid: 3, piid: 1 },
      { siid: 3, piid: 2 },
      { siid: 4, piid: 4 },
      { siid: 4, piid: 5 },
      { siid: 2, piid: 6 },
      { siid: 4, piid: 63 },
    ]);

    expect(v.status).toBe(MiotState.Charging);
    expect(v.statusRaw).toBe(6);
    expect(v.battery).toBe(87);
    expect(v.charging).toBe(ChargingStatus.Charging);
    expect(v.isCharging).toBe(true);
    expect(v.isDocked).toBe(true); // Charging/ChargingComplete => docked
    expect(v.suction).toBe(SuctionLevel.Intense);
    expect(v.water).toBe(WaterVolume.Low);
    expect(v.cleaningMode).toBe(CleaningMode.SweepAndMop);
    expect(v.errorCode).toBe(0);
    expect(v.faults).toEqual([18, 107]);
    expect(v.taskProgressPct).toBe(42);
    await v.close();
  });

  it('returns null typed-state for unseeded / out-of-enum values', async () => {
    const v = new VacuumDevice({
      device: fakeDevice(),
      region: 'eu',
      sessionRef: fakeSession,
      deps: depsReturning([{ siid: 4, piid: 4, value: 99, code: 0 }]),
      fetchInitialValues: false,
    });
    await v.start();
    expect(v.status).toBeNull();
    expect(v.battery).toBeNull();
    await v.refreshProperties([{ siid: 4, piid: 4 }]);
    expect(v.suctionRaw).toBe(99);
    expect(v.suction).toBeNull(); // 99 not a SuctionLevel member
    await v.close();
  });

  it('decodes seeded consumable + settings properties into the numeric getters', async () => {
    const results: PropertyResult[] = [
      { siid: 9, piid: 2, value: 80, code: 0 }, // MAIN_BRUSH_LEFT
      { siid: 10, piid: 2, value: 65, code: 0 }, // SIDE_BRUSH_LEFT
      { siid: 11, piid: 1, value: 50, code: 0 }, // FILTER_LEFT
      { siid: 7, piid: 1, value: 70, code: 0 }, // VOLUME
      { siid: 4, piid: 63, value: 33, code: 0 }, // TASK_PROGRESS_PCT
    ];
    const v = new VacuumDevice({
      device: fakeDevice(),
      region: 'eu',
      sessionRef: fakeSession,
      deps: depsReturning(results),
      fetchInitialValues: false,
    });
    await v.start();
    await v.refreshProperties([
      { siid: 9, piid: 2 },
      { siid: 10, piid: 2 },
      { siid: 11, piid: 1 },
      { siid: 7, piid: 1 },
      { siid: 4, piid: 63 },
    ]);

    expect(v.mainBrushLeftPct).toBe(80);
    expect(v.sideBrushLeftPct).toBe(65);
    expect(v.filterLeftPct).toBe(50);
    expect(v.volume).toBe(70);
    expect(v.taskProgressPct).toBe(33);
    await v.close();
  });

  it('exposes the rich vacuum capabilities (r2538z assumed) + generic tokens', () => {
    const v = new VacuumDevice({
      device: fakeDevice(),
      region: 'eu',
      sessionRef: fakeSession,
      deps: depsReturning([]),
      fetchInitialValues: false,
    });
    expect(v.vacuumCapabilities.canMop).toBe(true);
    expect(v.vacuumCapabilities.verified).toBe(false); // r2538z assumed
    expect(v.capabilities.has('mop')).toBe(true); // inherited generic tokens
  });
});
