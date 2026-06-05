import { describe, it, expect } from 'vitest';
import { BaseDevice } from '../../../src/device/base-device.js';
import { MowerDevice } from '../../../src/models/mower/mower-device.js';
import type { BaseDeviceDeps, PushLike } from '../../../src/device/base-device.js';
import type { DreameDevice, DreameSession, MiotAction } from '../../../src/cloud/types.js';

function session(): DreameSession {
  return { accessToken: 't', uid: 'u', expiresAt: Date.now() + 1e6, region: 'eu' };
}
function device(model = 'dreame.mower.p2255'): DreameDevice {
  return { did: 'm1', model, name: 'Mowy', online: true, raw: {} };
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

interface Harness {
  m: MowerDevice;
  actions: MiotAction[];
}
function build(model?: string): Harness {
  const actions: MiotAction[] = [];
  const deps: BaseDeviceDeps = {
    createPush: () => push(),
    getProperties: () => Promise.resolve([]),
    getCachedProperties: () => Promise.resolve([]),
    setProperties: () => Promise.resolve([]),
    callAction: (_base, action) => {
      actions.push(action);
      return Promise.resolve({});
    },
  };
  const m = new MowerDevice({
    device: device(model),
    region: 'eu',
    sessionRef: session,
    deps,
    fetchInitialValues: false,
  });
  return { m, actions };
}

describe('MowerDevice commands -> wire payloads', () => {
  it('no-arg actions dispatch siid 5 aiid with empty in[] (start is startMowing, NOT start)', async () => {
    const cases: Array<[(m: MowerDevice) => Promise<unknown>, number, number]> = [
      [(m) => m.startMowing(), 5, 1],
      [(m) => m.stop(), 5, 2],
      [(m) => m.dock(), 5, 3],
      [(m) => m.pause(), 5, 4],
    ];
    for (const [call, siid, aiid] of cases) {
      const { m, actions } = build();
      await call(m);
      expect(actions).toHaveLength(1);
      expect(actions[0]).toEqual({ siid, aiid, in: [] });
      await m.close();
    }
  });

  it('startMowing must NOT collide with the lifecycle start()', () => {
    // start() is BaseDevice's MQTT lifecycle method; startMowing() is the command.
    expect(typeof MowerDevice.prototype.start).toBe('function');
    expect(typeof MowerDevice.prototype.startMowing).toBe('function');
    expect(MowerDevice.prototype.start).not.toBe(MowerDevice.prototype.startMowing);
    // The lifecycle method is inherited verbatim from BaseDevice (not overridden).
    expect(MowerDevice.prototype.start).toBe(BaseDevice.prototype.start);
  });

  it('resume sends action 2:50 with the exact continueControl opcode [{m,p,o}]', async () => {
    const { m, actions } = build();
    await m.resume();
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({ siid: 2, aiid: 50, in: [{ m: 'a', p: 0, o: 5 }] });
    await m.close();
  });

  it('resume builds a FRESH opcode object each call (no shared-mutable leak)', async () => {
    const { m, actions } = build();
    await m.resume();
    await m.resume();
    expect(actions).toHaveLength(2);
    const first = actions[0]?.in?.[0];
    const second = actions[1]?.in?.[0];
    expect(first).toEqual({ m: 'a', p: 0, o: 5 });
    expect(second).toEqual({ m: 'a', p: 0, o: 5 });
    expect(first).not.toBe(second);
    await m.close();
  });

  it('startMowingAllArea sends 2:50 o:100 region_id/area_id', async () => {
    const { m, actions } = build();
    await m.startMowingAllArea(2);
    expect(actions[0]).toEqual({
      siid: 2,
      aiid: 50,
      in: [{ m: 'a', p: 0, o: 100, d: { region_id: [2], area_id: [] } }],
    });
    await m.close();
  });

  it('startMowingZones sends 2:50 o:102 region', async () => {
    const { m, actions } = build();
    await m.startMowingZones([1, 3]);
    expect(actions[0]).toEqual({
      siid: 2,
      aiid: 50,
      in: [{ m: 'a', p: 0, o: 102, d: { region: [1, 3] } }],
    });
    await m.close();
  });

  it('startMowingEdges sends 2:50 o:101 edge pairs', async () => {
    const { m, actions } = build();
    await m.startMowingEdges([
      [1, 0],
      [2, 0],
    ]);
    expect(actions[0]).toEqual({
      siid: 2,
      aiid: 50,
      in: [
        {
          m: 'a',
          p: 0,
          o: 101,
          d: {
            edge: [
              [1, 0],
              [2, 0],
            ],
          },
        },
      ],
    });
    await m.close();
  });

  it('startMowingSpots sends 2:50 o:103 area', async () => {
    const { m, actions } = build();
    await m.startMowingSpots([5]);
    expect(actions[0]).toEqual({
      siid: 2,
      aiid: 50,
      in: [{ m: 'a', p: 0, o: 103, d: { area: [5] } }],
    });
    await m.close();
  });

  it('throws RangeError on empty zone/edge/spot lists', async () => {
    const { m } = build();
    await expect(m.startMowingZones([])).rejects.toBeInstanceOf(RangeError);
    await expect(m.startMowingEdges([])).rejects.toBeInstanceOf(RangeError);
    await expect(m.startMowingSpots([])).rejects.toBeInstanceOf(RangeError);
    await m.close();
  });

  it('throws when the model lacks the targeted-mowing capability', async () => {
    const { m } = build('dreame.mower.zzz999'); // fallback: targeted off
    await expect(m.startMowingZones([1])).rejects.toThrow(/zone/i);
    await expect(m.startMowingEdges([[1, 0]])).rejects.toThrow(/edge/i);
    await expect(m.startMowingSpots([1])).rejects.toThrow(/spot/i);
    await expect(m.startMowingAllArea(1)).rejects.toThrow(/all-area/i);
    await m.close();
  });

  it('resume works on the fallback model (resume is generic)', async () => {
    const { m, actions } = build('dreame.mower.zzz999');
    await m.resume();
    expect(actions[0]).toEqual({ siid: 2, aiid: 50, in: [{ m: 'a', p: 0, o: 5 }] });
    await m.close();
  });
});
