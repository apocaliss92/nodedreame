import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { BaseDevice } from '../../src/device/base-device.js';
import type { BaseDeviceDeps, PushLike } from '../../src/device/base-device.js';
import type { DreameDevice, DreameSession, PropertyResult } from '../../src/cloud/types.js';
import { DreameTransportError } from '../../src/transport/errors.js';

const device: DreameDevice = {
  did: 'DID1',
  model: 'dreame.vacuum.r2532a',
  name: 'Vac',
  online: true,
  raw: { bindDomain: 'broker.example:1' },
};

const session = (token: string): DreameSession => ({
  accessToken: token,
  uid: 'UID',
  expiresAt: Date.now() + 1e6,
  region: 'eu',
});

/** A fake push exposing exactly the PushLike surface BaseDevice consumes. */
class FakePush extends EventEmitter implements PushLike {
  opened = false;
  closed = false;
  refreshed: string[] = [];
  async open(): Promise<void> {
    this.opened = true;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
  async refreshSession(s: DreameSession): Promise<void> {
    this.refreshed.push(s.accessToken);
  }
  // typed re-emit helpers used by tests
  emitProperties(changes: { did: string; siid: number; piid: number; value: unknown }[]): void {
    this.emit('properties', changes);
  }
}

function makeDeps(overrides: Partial<BaseDeviceDeps> = {}): {
  deps: BaseDeviceDeps;
  push: FakePush;
  getProperties: ReturnType<typeof vi.fn>;
  setProperties: ReturnType<typeof vi.fn>;
  callAction: ReturnType<typeof vi.fn>;
} {
  const push = new FakePush();
  const getProperties = vi.fn(overrides.getProperties ?? (async () => [] as PropertyResult[]));
  const setProperties = vi.fn(overrides.setProperties ?? (async () => [] as PropertyResult[]));
  const callAction = vi.fn(overrides.callAction ?? (async () => ({ ok: true })));
  const deps: BaseDeviceDeps = {
    createPush: overrides.createPush ?? (() => push),
    getProperties,
    setProperties,
    callAction,
  };
  return { deps, push, getProperties, setProperties, callAction };
}

describe('BaseDevice — construction & reads', () => {
  it('exposes deviceId, model and name', () => {
    const { deps } = makeDeps();
    const d = new BaseDevice({
      device,
      region: 'eu',
      sessionRef: () => session('T'),
      deps,
      fetchInitialValues: false,
    });
    expect(d.deviceId).toBe('DID1');
    expect(d.model).toBe('dreame.vacuum.r2532a');
    expect(d.name).toBe('Vac');
  });

  it('start() opens the push and (when enabled) seeds the cache eagerly', async () => {
    const { deps, push, getProperties } = makeDeps({
      getProperties: vi.fn(async () => [{ siid: 2, piid: 1, value: 99 }] as PropertyResult[]),
    });
    const d = new BaseDevice({
      device,
      region: 'eu',
      sessionRef: () => session('T'),
      deps,
      fetchInitialValues: true,
      initialProps: [{ siid: 2, piid: 1 }],
    });
    await d.start();
    expect(push.opened).toBe(true);
    expect(getProperties).toHaveBeenCalledTimes(1);
    expect(d.getProperty(2, 1)?.value).toBe(99);
  });

  it('fetchInitialValues:false does NOT read on start', async () => {
    const { deps, getProperties } = makeDeps();
    const d = new BaseDevice({
      device,
      region: 'eu',
      sessionRef: () => session('T'),
      deps,
      fetchInitialValues: false,
    });
    await d.start();
    expect(getProperties).not.toHaveBeenCalled();
    expect(d.getProperty(2, 1)).toBeUndefined();
  });

  it('refreshProperties reads live, updates cache, returns results', async () => {
    const { deps } = makeDeps({
      getProperties: vi.fn(async () => [{ siid: 3, piid: 1, value: 55 }] as PropertyResult[]),
    });
    const d = new BaseDevice({
      device,
      region: 'eu',
      sessionRef: () => session('T'),
      deps,
      fetchInitialValues: false,
    });
    const res = await d.refreshProperties([{ siid: 3, piid: 1 }]);
    expect(res[0]?.value).toBe(55);
    expect(d.getProperty(3, 1)?.value).toBe(55);
  });

  it('setProperty delegates with the device did and the CURRENT session token', async () => {
    let token = 'T1';
    const { deps, setProperties } = makeDeps();
    const d = new BaseDevice({
      device,
      region: 'eu',
      sessionRef: () => session(token),
      deps,
      fetchInitialValues: false,
    });
    token = 'T2';
    await d.setProperty({ siid: 2, piid: 4, value: 1 });
    const [base, writes] = setProperties.mock.calls[0]!;
    expect(base.did).toBe('DID1');
    expect(base.session.accessToken).toBe('T2');
    expect(writes).toEqual([{ siid: 2, piid: 4, value: 1 }]);
  });

  it('callAction delegates with did + current session and forwards inputs', async () => {
    const { deps, callAction } = makeDeps();
    const d = new BaseDevice({
      device,
      region: 'eu',
      sessionRef: () => session('TT'),
      deps,
      fetchInitialValues: false,
    });
    await d.callAction(4, 1, [{ piid: 1, value: 2 }]);
    const [base, action] = callAction.mock.calls[0]!;
    expect(base.did).toBe('DID1');
    expect(base.session.accessToken).toBe('TT');
    expect(action).toEqual({ siid: 4, aiid: 1, in: [{ piid: 1, value: 2 }] });
  });
});

describe('BaseDevice — cache & events from push', () => {
  it('mirrors a properties push into the cache and emits per-prop + aggregate', async () => {
    const { deps, push } = makeDeps();
    const d = new BaseDevice({
      device,
      region: 'eu',
      sessionRef: () => session('T'),
      deps,
      fetchInitialValues: false,
    });
    const perProp: number[] = [];
    let aggregate: number | null = null;
    d.on('propertyChanged', (e) => perProp.push(e.siid));
    d.on('stateChanged', (e) => {
      aggregate = e.changes.length;
    });
    await d.start();

    push.emitProperties([
      { did: 'DID1', siid: 2, piid: 1, value: 10 },
      { did: 'DID1', siid: 3, piid: 1, value: 20 },
    ]);

    expect(d.getProperty(2, 1)?.value).toBe(10);
    expect(d.getProperty(3, 1)?.value).toBe(20);
    expect(perProp).toEqual([2, 3]);
    expect(aggregate).toBe(2);
  });

  it('reports previousValue on a subsequent change to the same property', async () => {
    const { deps, push } = makeDeps();
    const d = new BaseDevice({
      device,
      region: 'eu',
      sessionRef: () => session('T'),
      deps,
      fetchInitialValues: false,
    });
    const seen: { value: unknown; previousValue: unknown }[] = [];
    d.on('propertyChanged', (e) => seen.push({ value: e.value, previousValue: e.previousValue }));
    await d.start();

    push.emitProperties([{ did: 'DID1', siid: 2, piid: 1, value: 10 }]);
    push.emitProperties([{ did: 'DID1', siid: 2, piid: 1, value: 11 }]);

    expect(seen[0]).toEqual({ value: 10, previousValue: null });
    expect(seen[1]).toEqual({ value: 11, previousValue: 10 });
  });

  it('emits a typed device event on an event push', async () => {
    const { deps, push } = makeDeps();
    const d = new BaseDevice({
      device,
      region: 'eu',
      sessionRef: () => session('T'),
      deps,
      fetchInitialValues: false,
    });
    const events: { siid: number; eiid: number }[] = [];
    d.on('event', (e) => events.push({ siid: e.siid, eiid: e.eiid }));
    await d.start();
    push.emit('event', { did: 'DID1', siid: 4, eiid: 1, arguments: [] });
    expect(events).toEqual([{ siid: 4, eiid: 1 }]);
  });
});

describe('BaseDevice — poll fallback', () => {
  it('polls getProperties while MQTT is down and stops once it reconnects', async () => {
    vi.useFakeTimers();
    try {
      const getProperties = vi.fn(async () => [{ siid: 2, piid: 1, value: 1 }] as PropertyResult[]);
      const { deps, push } = makeDeps({ getProperties });
      const d = new BaseDevice({
        device,
        region: 'eu',
        sessionRef: () => session('T'),
        deps,
        fetchInitialValues: false,
        initialProps: [{ siid: 2, piid: 1 }],
        pollIntervalMs: 1000,
      });
      await d.start(); // connect => healthy => no polling
      expect(getProperties).not.toHaveBeenCalled();

      push.emit('close'); // MQTT down => start polling
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);
      expect(getProperties).toHaveBeenCalledTimes(2);

      push.emit('connect'); // MQTT back => stop polling
      await vi.advanceTimersByTimeAsync(5000);
      expect(getProperties).toHaveBeenCalledTimes(2); // no further polls

      await d.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not poll when pollIntervalMs is 0', async () => {
    vi.useFakeTimers();
    try {
      const getProperties = vi.fn(async () => [] as PropertyResult[]);
      const { deps, push } = makeDeps({ getProperties });
      const d = new BaseDevice({
        device,
        region: 'eu',
        sessionRef: () => session('T'),
        deps,
        fetchInitialValues: false,
        initialProps: [{ siid: 2, piid: 1 }],
        pollIntervalMs: 0,
      });
      await d.start();
      push.emit('close');
      await vi.advanceTimersByTimeAsync(10000);
      expect(getProperties).not.toHaveBeenCalled();
      await d.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('close() clears the poll timer', async () => {
    vi.useFakeTimers();
    try {
      const getProperties = vi.fn(async () => [] as PropertyResult[]);
      const { deps, push } = makeDeps({ getProperties });
      const d = new BaseDevice({
        device,
        region: 'eu',
        sessionRef: () => session('T'),
        deps,
        fetchInitialValues: false,
        initialProps: [{ siid: 2, piid: 1 }],
        pollIntervalMs: 1000,
      });
      await d.start();
      push.emit('close'); // polling armed
      await d.close();
      await vi.advanceTimersByTimeAsync(5000);
      expect(getProperties).not.toHaveBeenCalled();
      expect(push.closed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('BaseDevice — closed guards (FIX 2)', () => {
  function closedDevice() {
    const { deps } = makeDeps();
    return new BaseDevice({
      device,
      region: 'eu',
      sessionRef: () => session('T'),
      deps,
      fetchInitialValues: false,
    });
  }

  it('refreshProperties after close() throws a clear error', async () => {
    const d = closedDevice();
    await d.start();
    await d.close();
    await expect(d.refreshProperties([{ siid: 2, piid: 1 }])).rejects.toThrow(DreameTransportError);
    await expect(d.refreshProperties([{ siid: 2, piid: 1 }])).rejects.toThrow(/closed/i);
  });

  it('setProperty after close() throws a clear error', async () => {
    const d = closedDevice();
    await d.start();
    await d.close();
    await expect(d.setProperty({ siid: 2, piid: 4, value: 1 })).rejects.toThrow(
      DreameTransportError,
    );
    await expect(d.setProperty({ siid: 2, piid: 4, value: 1 })).rejects.toThrow(/closed/i);
  });

  it('callAction after close() throws a clear error', async () => {
    const d = closedDevice();
    await d.start();
    await d.close();
    await expect(d.callAction(4, 1)).rejects.toThrow(DreameTransportError);
    await expect(d.callAction(4, 1)).rejects.toThrow(/closed/i);
  });
});

describe('PushLike — honest event surface (FIX 4)', () => {
  it('does not advertise an unhandled "props" overload that start() never subscribes to', () => {
    const push: PushLike = new FakePush();
    // The PushLike interface must only declare events BaseDevice.start() wires.
    // Subscribing to 'props' must be a type error (no such overload on PushLike).
    // @ts-expect-error 'props' is not part of the honest PushLike surface
    push.on('props', () => {});
    expect(typeof push.on).toBe('function');
  });
});
