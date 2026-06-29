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
import type {
  DreameDevice,
  DreameSession,
  PropertyResult,
  PropertyWrite,
} from '../../../src/cloud/types.js';

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

  it('decodes the packed AI_DETECTION int into per-feature booleans + supportedAiFeatures', async () => {
    // 271 = furniture(1)+obstacle(2)+obstaclePicture(4)+fluid(8)+fuzzy(256).
    const v = new VacuumDevice({
      device: fakeDevice('dreame.vacuum.r2538z'),
      region: 'eu',
      sessionRef: fakeSession,
      deps: depsReturning([{ siid: 4, piid: 22, value: 271, code: 0 }]),
      fetchInitialValues: false,
    });
    await v.start();
    await v.refreshProperties([{ siid: 4, piid: 22 }]);
    expect(v.aiFeature('obstacleDetection')).toBe(true);
    expect(v.aiFeature('fluidDetection')).toBe(true);
    expect(v.aiFeature('petDetection')).toBe(false);
    expect(v.aiFeature('obstacleImageUpload')).toBe(false);
    expect(v.supportedAiFeatures).toContain('obstacleDetection');
    expect(v.supportedAiFeatures).toContain('petDetection');
    await v.close();
  });

  it('setAiFeature read-modify-writes AI_DETECTION (siid 4 piid 22) preserving the other bits', async () => {
    const writes: PropertyWrite[][] = []
    const deps: BaseDeviceDeps = {
      createPush: () => fakePush(),
      getProperties: () => Promise.resolve([{ siid: 4, piid: 22, value: 271, code: 0 }]),
      getCachedProperties: () => Promise.resolve([{ siid: 4, piid: 22, value: 271, code: 0 }]),
      setProperties: (_base, w) => {
        writes.push(w)
        return Promise.resolve([])
      },
      callAction: () => Promise.resolve({}),
    }
    const v = new VacuumDevice({
      device: fakeDevice('dreame.vacuum.r2538z'),
      region: 'eu',
      sessionRef: fakeSession,
      deps,
      fetchInitialValues: false,
    })
    await v.start()
    await v.refreshProperties([{ siid: 4, piid: 22 }])
    // turn pet (bit 16) ON -> 271 | 16 = 287, other bits intact
    await v.setAiFeature('petDetection', true)
    expect(writes[0]).toEqual([{ siid: 4, piid: 22, value: 287 }])
    await v.close()
  })

  it('refreshAiDetection seeds AI_DETECTION from the cloud shadow (no robot wake)', async () => {
    const calls: ('live' | 'cache')[] = []
    const deps: BaseDeviceDeps = {
      createPush: () => fakePush(),
      getProperties: () => {
        calls.push('live')
        return Promise.resolve([] as PropertyResult[])
      },
      getCachedProperties: () => {
        calls.push('cache')
        return Promise.resolve([{ siid: 4, piid: 22, value: 271, code: 0 }])
      },
      setProperties: () => Promise.resolve([]),
      callAction: () => Promise.resolve({}),
    }
    const v = new VacuumDevice({
      device: fakeDevice('dreame.vacuum.r2538z'),
      region: 'eu',
      sessionRef: fakeSession,
      deps,
      fetchInitialValues: false,
    })
    await v.start()
    const raw = await v.refreshAiDetection()
    expect(calls).toEqual(['cache']) // shadow read only, never the waking path
    expect(raw).toBe(271)
    expect(v.aiFeature('obstacleDetection')).toBe(true)
    await v.close()
  })

  it('refreshAiDetection returns null when the model lacks AI obstacle detection', async () => {
    const v = new VacuumDevice({
      device: fakeDevice('dreame.vacuum.zzz999'),
      region: 'eu',
      sessionRef: fakeSession,
      deps: depsReturning([]),
      fetchInitialValues: false,
    })
    await v.start()
    expect(await v.refreshAiDetection()).toBeNull()
    await v.close()
  })

  it('setAiFeature throws when the model lacks AI obstacle detection', async () => {
    const v = new VacuumDevice({
      device: fakeDevice('dreame.vacuum.zzz999'), // fallback: hasAiObstacleDetection=false
      region: 'eu',
      sessionRef: fakeSession,
      deps: depsReturning([{ siid: 4, piid: 22, value: 271, code: 0 }]),
      fetchInitialValues: false,
    })
    await v.start()
    await v.refreshProperties([{ siid: 4, piid: 22 }])
    await expect(v.setAiFeature('petDetection', true)).rejects.toThrow(/AI obstacle detection/)
    await v.close()
  })

  it('supportedConsumables is PRESENCE-driven: only reported life props appear, with reset flags', async () => {
    // Device reports main-brush(9/2), filter(11/1), mop-pad(18/1) — but NOT
    // side-brush / sensor / etc. → only the reported three are supported.
    const results: PropertyResult[] = [
      { siid: 9, piid: 2, value: 80, code: 0 }, // main-brush
      { siid: 11, piid: 1, value: 55, code: 0 }, // filter
      { siid: 18, piid: 1, value: 30, code: 0 }, // mop-pad
    ]
    const v = new VacuumDevice({
      device: fakeDevice('dreame.vacuum.r2538z'),
      region: 'eu',
      sessionRef: fakeSession,
      deps: depsReturning(results),
      fetchInitialValues: false,
    })
    await v.start()
    await v.refreshProperties([
      { siid: 9, piid: 2 },
      { siid: 11, piid: 1 },
      { siid: 18, piid: 1 },
    ])
    const c = v.supportedConsumables
    expect(c.map((x) => x.key).sort()).toEqual(['filter', 'main-brush', 'mop-pad'])
    expect(c.find((x) => x.key === 'mop-pad')).toEqual({
      key: 'mop-pad',
      label: 'Mop Pad',
      leftPct: 30,
      resettable: true,
    })
    expect(v.consumableLeftPct('side-brush')).toBeNull() // not reported -> unsupported
    await v.close()
  })

  it('resetConsumable dispatches the consumable service reset action (aiid 1)', async () => {
    const { v, actions } = (() => {
      const actions: { siid: number; aiid: number }[] = []
      const deps: BaseDeviceDeps = {
        createPush: () => fakePush(),
        getProperties: () => Promise.resolve([]),
        getCachedProperties: () => Promise.resolve([]),
        setProperties: () => Promise.resolve([]),
        callAction: (_base, a) => {
          actions.push({ siid: a.siid, aiid: a.aiid })
          return Promise.resolve({})
        },
      }
      const v = new VacuumDevice({
        device: fakeDevice('dreame.vacuum.r2538z'),
        region: 'eu',
        sessionRef: fakeSession,
        deps,
        fetchInitialValues: false,
      })
      return { v, actions }
    })()
    await v.start()
    await v.resetConsumable('main-brush')
    expect(actions[0]).toEqual({ siid: 9, aiid: 1 })
    // dust-bag has a life prop but NO reset action → throws.
    await expect(v.resetConsumable('dust-bag')).rejects.toThrow(/no reset action/)
    await v.close()
  })

  it('exposes the supported suction/water enum sets for r2538z', () => {
    const v = new VacuumDevice({
      device: fakeDevice('dreame.vacuum.r2538z'),
      region: 'eu',
      sessionRef: fakeSession,
      deps: depsReturning([]),
      fetchInitialValues: false,
    });
    expect(v.supportedSuctionLevels).toEqual([
      SuctionLevel.Quiet,
      SuctionLevel.Standard,
      SuctionLevel.Intense,
      SuctionLevel.Max,
    ]);
    expect(v.supportedWaterVolumes).toEqual([
      WaterVolume.Low,
      WaterVolume.Medium,
      WaterVolume.High,
    ]);
  });
});
