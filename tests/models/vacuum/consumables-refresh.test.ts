import { describe, it, expect } from 'vitest';
import { VacuumDevice } from '../../../src/models/vacuum/vacuum-device.js';
import { VACUUM_CONSUMABLES, consumableSpec } from '../../../src/models/vacuum/consumables.js';
import type { BaseDeviceDeps, PushLike } from '../../../src/device/base-device.js';
import type {
  DreameDevice,
  DreameSession,
  MiotProp,
  PropertyResult,
} from '../../../src/cloud/types.js';

function fakeSession(): DreameSession {
  return { accessToken: 't', uid: 'u', expiresAt: Date.now() + 1e6, region: 'eu' };
}

function fakeDevice(): DreameDevice {
  return { did: 'd1', model: 'dreame.vacuum.r2538z', name: 'Robi', online: true, raw: {} };
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

type Call =
  | { readonly kind: 'live'; readonly props: readonly MiotProp[] }
  | { readonly kind: 'shadow'; readonly props: readonly MiotProp[] }
  | { readonly kind: 'action'; readonly siid: number; readonly aiid: number };

/** A fake cloud: a mutable property table the reset action rewrites, as the robot does. */
interface FakeCloud {
  readonly deps: BaseDeviceDeps;
  readonly calls: Call[];
  readonly table: Map<string, number>;
}

function fakeCloud(opts: {
  readonly initial: Record<string, number>;
  readonly onAction?: (siid: number, table: Map<string, number>) => void;
  readonly liveFails?: boolean;
  readonly shadowFails?: boolean;
  readonly actionFails?: boolean;
}): FakeCloud {
  const table = new Map<string, number>(Object.entries(opts.initial));
  const calls: Call[] = [];
  const read = (props: readonly MiotProp[]): PropertyResult[] =>
    props.flatMap((p) => {
      const v = table.get(`${p.siid}.${p.piid}`);
      return v === undefined ? [] : [{ siid: p.siid, piid: p.piid, value: v, code: 0 }];
    });
  const deps: BaseDeviceDeps = {
    createPush: () => fakePush(),
    getProperties: (_b, props) => {
      calls.push({ kind: 'live', props });
      return opts.liveFails === true
        ? Promise.reject(new Error('80001 device unreachable'))
        : Promise.resolve(read(props));
    },
    getCachedProperties: (_b, props) => {
      calls.push({ kind: 'shadow', props });
      return opts.shadowFails === true
        ? Promise.reject(new Error('shadow down'))
        : Promise.resolve(read(props));
    },
    setProperties: () => Promise.resolve([]),
    callAction: (_b, a) => {
      calls.push({ kind: 'action', siid: a.siid, aiid: a.aiid });
      if (opts.actionFails === true) return Promise.reject(new Error('action refused'));
      opts.onAction?.(a.siid, table);
      return Promise.resolve({ code: 0 });
    },
  };
  return { deps, calls, table };
}

async function startedVacuum(cloud: FakeCloud): Promise<VacuumDevice> {
  const v = new VacuumDevice({
    device: fakeDevice(),
    region: 'eu',
    sessionRef: fakeSession,
    deps: cloud.deps,
    fetchInitialValues: false,
  });
  await v.start();
  return v;
}

/** The r2538z (4385) as the Dreame app showed it on 2026-09-26 ("Tempo residuo"). */
const APP_2026_09_26: Record<string, number> = {
  '9.2': 90, // main brush %
  '9.1': 271, // main brush hours left
  '10.2': 85, // side brush %
  '10.1': 171, // side brush hours left
  '11.1': 80, // filter %
  '11.2': 121, // filter hours left
  '16.1': 4, // sensors %
  '16.2': 1, // sensors hours left
};

/** The robot's reset of the sensor service: life back to 100 %, time left back to full. */
function resetSensor(siid: number, table: Map<string, number>): void {
  if (siid === 16) {
    table.set('16.1', 100);
    table.set('16.2', 30);
  }
}

describe('vacuum consumable time-left map', () => {
  it('pins the four pairs the Dreame app shows for the r2538z: property id AND unit', async () => {
    const cloud = fakeCloud({ initial: APP_2026_09_26 });
    const v = await startedVacuum(cloud);
    await v.refreshConsumables();

    expect(v.consumableLeftPct('main-brush')).toBe(90);
    expect(v.consumableTimeLeft('main-brush')).toEqual({ value: 271, unit: 'hours' });
    expect(v.consumableLeftPct('side-brush')).toBe(85);
    expect(v.consumableTimeLeft('side-brush')).toEqual({ value: 171, unit: 'hours' });
    expect(v.consumableLeftPct('filter')).toBe(80);
    expect(v.consumableTimeLeft('filter')).toEqual({ value: 121, unit: 'hours' });
    expect(v.consumableLeftPct('sensor')).toBe(4);
    expect(v.consumableTimeLeft('sensor')).toEqual({ value: 1, unit: 'hours' });
    await v.close();
  });

  it('refreshConsumables reads every life AND every time-left property in ONE shadow call', async () => {
    const cloud = fakeCloud({ initial: APP_2026_09_26 });
    const v = await startedVacuum(cloud);
    await v.refreshConsumables();

    expect(cloud.calls).toHaveLength(1);
    const call = cloud.calls[0];
    expect(call?.kind).toBe('shadow');
    const keys =
      call !== undefined && call.kind !== 'action'
        ? call.props.map((p) => `${p.siid}.${p.piid}`)
        : [];
    for (const spec of VACUUM_CONSUMABLES) {
      expect(keys).toContain(`${spec.life.siid}.${spec.life.piid}`);
      if (spec.timeLeft !== null) {
        expect(keys).toContain(`${spec.timeLeft.siid}.${spec.timeLeft.piid}`);
      }
    }
    await v.close();
  });

  it('a time-left twin never collides with a life property', () => {
    const life = new Set(VACUUM_CONSUMABLES.map((c) => `${c.life.siid}.${c.life.piid}`));
    for (const spec of VACUUM_CONSUMABLES) {
      if (spec.timeLeft === null) continue;
      expect(spec.timeLeft.siid).toBe(spec.life.siid);
      expect(life.has(`${spec.timeLeft.siid}.${spec.timeLeft.piid}`)).toBe(false);
    }
    expect(consumableSpec('dust-bag')?.timeLeft).toBeNull();
  });

  it('labels the sensor and wheel items as the maintenance the app asks for', () => {
    expect(consumableSpec('sensor')?.label).toBe('Sensor Dirty');
    expect(consumableSpec('wheel')?.label).toBe('Wheel Dirty');
  });
});

describe('VacuumDevice.resetConsumable re-reads what the reset changed', () => {
  it('after the action, the cache holds the NEW life % and time left (live read)', async () => {
    const cloud = fakeCloud({ initial: APP_2026_09_26, onAction: resetSensor });
    const v = await startedVacuum(cloud);
    await v.refreshConsumables();
    expect(v.consumableLeftPct('sensor')).toBe(4);

    const result = await v.resetConsumable('sensor');

    expect(v.consumableLeftPct('sensor')).toBe(100);
    expect(v.consumableTimeLeft('sensor')).toEqual({ value: 30, unit: 'hours' });
    expect(result).toEqual({
      key: 'sensor',
      actionResult: { code: 0 },
      refreshedFrom: 'device',
      leftPct: 100,
      timeLeft: { value: 30, unit: 'hours' },
      refreshError: null,
    });
    // One action, then ONE targeted live read of exactly the two properties.
    const afterSeed = cloud.calls.slice(1);
    expect(afterSeed).toEqual([
      { kind: 'action', siid: 16, aiid: 1 },
      {
        kind: 'live',
        props: [
          { siid: 16, piid: 1 },
          { siid: 16, piid: 2 },
        ],
      },
    ]);
    await v.close();
  });

  it('falls back to the cloud shadow when the live read fails, and says so', async () => {
    const cloud = fakeCloud({ initial: APP_2026_09_26, onAction: resetSensor, liveFails: true });
    const v = await startedVacuum(cloud);

    const result = await v.resetConsumable('sensor');

    expect(result.refreshedFrom).toBe('cloud-shadow');
    expect(result.leftPct).toBe(100);
    expect(v.consumableLeftPct('sensor')).toBe(100);
    expect(cloud.calls.map((c) => c.kind)).toEqual(['action', 'live', 'shadow']);
    await v.close();
  });

  it('a reset whose re-read fails both ways still resolves, reporting no fresh value', async () => {
    const cloud = fakeCloud({
      initial: APP_2026_09_26,
      onAction: resetSensor,
      liveFails: true,
      shadowFails: true,
    });
    const v = await startedVacuum(cloud);

    const result = await v.resetConsumable('sensor');

    expect(result.refreshedFrom).toBeNull();
    expect(result.leftPct).toBeNull();
    expect(result.timeLeft).toBeNull();
    expect(result.refreshError?.message).toMatch(/shadow down/);
    await v.close();
  });

  it('a failed action is NOT followed by a re-read', async () => {
    const cloud = fakeCloud({ initial: APP_2026_09_26, actionFails: true });
    const v = await startedVacuum(cloud);

    await expect(v.resetConsumable('sensor')).rejects.toThrow(/action refused/);
    expect(cloud.calls.map((c) => c.kind)).toEqual(['action']);
    await v.close();
  });
});
