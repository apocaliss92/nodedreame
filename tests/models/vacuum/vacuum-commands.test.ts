import { describe, it, expect } from 'vitest';
import { VacuumDevice } from '../../../src/models/vacuum/vacuum-device.js';
import { SuctionLevel, WaterVolume, CleaningMode } from '../../../src/models/vacuum/enums.js';
import type { BaseDeviceDeps, PushLike } from '../../../src/device/base-device.js';
import type {
  DreameDevice,
  DreameSession,
  MiotAction,
  PropertyWrite,
} from '../../../src/cloud/types.js';

function session(): DreameSession {
  return { accessToken: 't', uid: 'u', expiresAt: Date.now() + 1e6, region: 'eu' };
}

function device(model = 'dreame.vacuum.r2538z'): DreameDevice {
  return { did: 'd1', model, name: 'Robi', online: true, raw: {} };
}

function push(): PushLike {
  const fp: PushLike = {
    on: () => fp,
    open: () => Promise.resolve(),
    close: () => Promise.resolve(),
    refreshSession: () => Promise.resolve(),
  };
  return fp;
}

// Capture command payloads into exactly-typed arrays — no spies, no casts.
interface Harness {
  v: VacuumDevice;
  actions: MiotAction[];
  writes: PropertyWrite[][];
}

function build(model?: string): Harness {
  const actions: MiotAction[] = [];
  const writes: PropertyWrite[][] = [];
  const deps: BaseDeviceDeps = {
    createPush: () => push(),
    getProperties: () => Promise.resolve([]),
    getCachedProperties: () => Promise.resolve([]),
    setProperties: (_base, w) => {
      writes.push(w);
      return Promise.resolve([]);
    },
    callAction: (_base, action) => {
      actions.push(action);
      return Promise.resolve({});
    },
  };
  const v = new VacuumDevice({
    device: device(model),
    region: 'eu',
    sessionRef: session,
    deps,
    fetchInitialValues: false,
  });
  return { v, actions, writes };
}

describe('VacuumDevice commands -> wire payloads', () => {
  it('no-arg actions dispatch the right siid/aiid with empty in[]', async () => {
    // NOTE: the cleaning "start" action (siid 2 aiid 1) is exposed as
    // `startCleaning()`, NOT `start()`. `BaseDevice.start()` is the lifecycle
    // method that opens the MQTT push and must keep that meaning so the facade
    // can open handles. Commands do not require the push to be open
    // (`#assertOpen` only guards against a closed handle), so the lifecycle
    // open is unnecessary here.
    const cases: Array<[(v: VacuumDevice) => Promise<unknown>, number, number]> = [
      [(v) => v.startCleaning(), 2, 1],
      [(v) => v.pause(), 2, 2],
      [(v) => v.stop(), 4, 2],
      [(v) => v.dock(), 3, 1],
      [(v) => v.locate(), 7, 1],
    ];
    for (const [call, siid, aiid] of cases) {
      const { v, actions } = build();
      await call(v);
      expect(actions).toHaveLength(1);
      expect(actions[0]).toEqual({ siid, aiid, in: [] });
      await v.close();
    }
  });

  it('setSuction writes SUCTION_LEVEL after validating the level', async () => {
    const { v, writes } = build();
    await v.setSuction(SuctionLevel.Max);
    expect(writes[0]).toEqual([{ siid: 4, piid: 4, value: 3 }]);
    await v.close();
  });

  it('setWater writes WATER_VOLUME', async () => {
    const { v, writes } = build();
    await v.setWater(WaterVolume.High);
    expect(writes[0]).toEqual([{ siid: 4, piid: 5, value: 3 }]);
    await v.close();
  });

  it('setCleaningMode uses the SAFE CLEAN_MODE_SETTING (siid 2 piid 6), not the 0x1400 bitfield', async () => {
    const { v, writes } = build();
    await v.setCleaningMode(CleaningMode.SweepAndMop);
    expect(writes[0]).toEqual([{ siid: 2, piid: 6, value: 2 }]);
    await v.close();
  });

  it('cleanSegments builds START_CUSTOM mode 18 with selects [[id,repeats,fan,water,1]]', async () => {
    const { v, actions } = build();
    await v.cleanSegments([7, 4], { repeats: 2, fan: 1, water: 2 });
    const action = actions[0];
    expect(action?.siid).toBe(4);
    expect(action?.aiid).toBe(1);
    expect(action?.in?.[0]).toEqual({ piid: 1, value: 18 });
    expect(action?.in?.[1]).toEqual({
      piid: 10,
      value: JSON.stringify({
        selects: [
          [7, 2, 1, 2, 1],
          [4, 2, 1, 2, 1],
        ],
      }),
    });
    await v.close();
  });

  it('cleanZones builds START_CUSTOM mode 19 with rounded areas', async () => {
    const { v, actions } = build();
    await v.cleanZones([{ x0: 1.4, y0: 2.6, x1: 3, y1: 4 }], { repeats: 1, fan: 0, water: 1 });
    const action = actions[0];
    expect(action?.in?.[0]).toEqual({ piid: 1, value: 19 });
    expect(action?.in?.[1]).toEqual({
      piid: 10,
      value: JSON.stringify({ areas: [[1, 3, 3, 4, 1, 0, 1]] }),
    });
    await v.close();
  });

  it('cleanSpot builds START_CUSTOM mode 20 with a single rounded point', async () => {
    const { v, actions } = build();
    await v.cleanSpot({ x: 1200.7, y: -300.2 }, { repeats: 1, fan: 1, water: 2 });
    const action = actions[0];
    expect(action?.in?.[0]).toEqual({ piid: 1, value: 20 });
    expect(action?.in?.[1]).toEqual({
      piid: 10,
      value: JSON.stringify({ points: [[1201, -300, 1, 1, 2]] }),
    });
    await v.close();
  });

  it('clean helpers default fan/water from cached raw state', async () => {
    const { v, actions } = build();
    // No opts and no cached state -> defaults fan=Standard(1), water=Medium(2).
    await v.cleanSegments([5]);
    expect(actions[0]?.in?.[1]).toEqual({
      piid: 10,
      value: JSON.stringify({ selects: [[5, 1, 1, 2, 1]] }),
    });
    await v.close();
  });

  it('startAutoEmpty dispatches when the model supports auto-empty', async () => {
    const { v, actions } = build();
    await v.startAutoEmpty();
    expect(actions[0]).toEqual({ siid: 15, aiid: 1, in: [] });
    await v.close();
  });

  it('clearWarning dispatches CLEAR_WARNING (siid 4 aiid 3)', async () => {
    const { v, actions } = build();
    await v.clearWarning();
    expect(actions[0]).toEqual({ siid: 4, aiid: 3, in: [] });
    await v.close();
  });

  it('throws RangeError on empty segment/zone lists', async () => {
    const { v } = build();
    await expect(v.cleanSegments([])).rejects.toBeInstanceOf(RangeError);
    await expect(v.cleanZones([])).rejects.toBeInstanceOf(RangeError);
    await v.close();
  });

  it('validates an empty target array BEFORE the capability gate (RangeError, not DreameError)', async () => {
    // Model with canCleanPerRoom=false: an empty array must still surface the
    // argument error (RangeError), not the capability error — argument
    // validation precedes capability gating (donor convention).
    const { v } = build('dreame.vacuum.zzz999');
    await expect(v.cleanSegments([])).rejects.toBeInstanceOf(RangeError);
    await expect(v.cleanZones([])).rejects.toBeInstanceOf(RangeError);
    await v.close();
  });

  it('throws when the model lacks per-room capability', async () => {
    const { v } = build('dreame.vacuum.zzz999'); // fallback: canCleanPerRoom=false
    await expect(v.cleanSegments([1])).rejects.toThrow(/per-room/);
    await expect(v.cleanZones([{ x0: 0, y0: 0, x1: 1, y1: 1 }])).rejects.toThrow(/per-room/);
    await expect(v.cleanSpot({ x: 0, y: 0 })).rejects.toThrow(/per-room/);
    await v.close();
  });

  it('throws when the model lacks auto-empty capability', async () => {
    const { v } = build('dreame.vacuum.zzz999'); // fallback: canAutoEmpty=false
    await expect(v.startAutoEmpty()).rejects.toThrow(/auto-empty/);
    await v.close();
  });

  it('setSuctionRaw rejects an invalid number with RangeError', async () => {
    const { v } = build();
    // 9 is not a SuctionLevel member -> rejected. Raw entry takes a plain
    // number, so the validation path is exercised with ZERO casts.
    await expect(v.setSuctionRaw(9)).rejects.toBeInstanceOf(RangeError);
    await v.close();
  });

  it('setSuctionRaw accepts a valid number and writes SUCTION_LEVEL', async () => {
    const { v, writes } = build();
    await v.setSuctionRaw(2);
    expect(writes[0]).toEqual([{ siid: 4, piid: 4, value: 2 }]);
    await v.close();
  });

  it('setWaterRaw rejects an invalid number with RangeError', async () => {
    const { v } = build();
    await expect(v.setWaterRaw(9)).rejects.toBeInstanceOf(RangeError);
    await v.close();
  });
});
