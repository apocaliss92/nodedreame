import { describe, it, expect, vi } from 'vitest';
import { Nodreame } from '../../src/api/nodreame.js';
import type { NodreameDeps } from '../../src/api/nodreame.js';
import type { DreameDevice, DreameSession } from '../../src/cloud/types.js';
import { BaseDevice } from '../../src/device/base-device.js';

const sessionAt = (token: string, expiresAt: number): DreameSession => ({
  accessToken: token,
  uid: 'UID',
  expiresAt,
  region: 'eu',
});

const dev = (did: string): DreameDevice => ({
  did,
  model: 'dreame.vacuum.r2532a',
  name: did,
  online: true,
  raw: { bindDomain: 'broker:1' },
});

function makeDeps(over: Partial<NodreameDeps> = {}): NodreameDeps {
  return {
    login: vi.fn(async () => sessionAt('A', Date.now() + 1e6)),
    refresh: vi.fn(async () => sessionAt('B', Date.now() + 1e6)),
    listDevices: vi.fn(async () => [dev('D1'), dev('D2')]),
    createDevice: (args) =>
      new BaseDevice({ ...args, fetchInitialValues: false, deps: fakeBaseDeviceDeps() }),
    ...over,
  };
}

// Minimal BaseDeviceDeps so created handles never touch the network.
function fakeBaseDeviceDeps() {
  return {
    createPush: () => ({
      on() {
        return this;
      },
      async open() {},
      async close() {},
      async refreshSession() {},
    }),
    getProperties: vi.fn(async () => []),
    setProperties: vi.fn(async () => []),
    callAction: vi.fn(async () => null),
  };
}

describe('Nodreame.login + discoverDevices', () => {
  it('login obtains a session, discoverDevices builds one handle per device', async () => {
    const deps = makeDeps();
    const n = new Nodreame({ username: 'a@b.c', password: 'pw', region: 'eu' }, deps);
    await n.login();
    const handles = await n.discoverDevices();
    expect(handles).toHaveLength(2);
    expect(handles.map((h) => h.deviceId)).toEqual(['D1', 'D2']);
    await n.close();
  });

  it('discoverDevices auto-logs-in when no session yet', async () => {
    const deps = makeDeps();
    const n = new Nodreame({ username: 'a@b.c', password: 'pw', region: 'eu' }, deps);
    const handles = await n.discoverDevices();
    expect(deps.login).toHaveBeenCalledTimes(1);
    expect(handles).toHaveLength(2);
    await n.close();
  });
});

describe('Nodreame — refresh propagation & teardown', () => {
  it('an expiring session refreshes and pushes the new token to every device', async () => {
    const refreshed: string[][] = [];
    const refresh = vi.fn(async () => sessionAt('REFRESHED', Date.now() + 1e6));
    const createDevice = (args: { sessionRef: () => DreameSession }) => {
      const calls: string[] = [];
      refreshed.push(calls);
      const baseDeps = {
        createPush: () => ({
          on() {
            return this;
          },
          async open() {},
          async close() {},
          async refreshSession(s: DreameSession) {
            calls.push(s.accessToken);
          },
        }),
        getProperties: vi.fn(async () => []),
        setProperties: vi.fn(async () => []),
        callAction: vi.fn(async () => null),
      };
      return new BaseDevice({
        device: dev('X'),
        region: 'eu',
        sessionRef: args.sessionRef,
        fetchInitialValues: false,
        deps: baseDeps,
      });
    };
    // First login: valid at discovery time (outside the leeway window) but
    // expiring soon + carrying a refresh token. Devices are built FIRST with
    // this session; advancing time past the leeway makes the subsequent
    // ensureSession() refresh and propagate the new token to the live pushes.
    const login = vi.fn(async () => ({
      accessToken: 'OLD',
      refreshToken: 'RT',
      uid: 'UID',
      expiresAt: Date.now() + 200_000,
      region: 'eu' as const,
    }));
    const deps = makeDeps({ login, refresh, createDevice });

    vi.useFakeTimers();
    try {
      const n = new Nodreame({ username: 'a@b.c', password: 'pw', region: 'eu' }, deps);
      await n.login();
      await n.discoverDevices(); // builds 2 handles with the OLD session (valid, outside leeway)

      // Cross into the leeway window (default leeway ~100s; expiry at +200s).
      vi.advanceTimersByTime(150_000);

      // ensureSession now sees the session inside the leeway window -> refreshes.
      const s = await n.ensureSession();
      expect(s.accessToken).toBe('REFRESHED');
      expect(refresh).toHaveBeenCalledTimes(1);
      // Every device push received the refreshed token.
      expect(refreshed).toHaveLength(2);
      for (const calls of refreshed) {
        expect(calls).toContain('REFRESHED');
      }
      await n.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('close() closes every device push and clears handles', async () => {
    const closed: boolean[] = [];
    const createDevice = (args: { sessionRef: () => DreameSession }) => {
      let isClosed = false;
      closed.push(isClosed);
      const idx = closed.length - 1;
      const baseDeps = {
        createPush: () => ({
          on() {
            return this;
          },
          async open() {},
          async close() {
            isClosed = true;
            closed[idx] = true;
          },
          async refreshSession() {},
        }),
        getProperties: vi.fn(async () => []),
        setProperties: vi.fn(async () => []),
        callAction: vi.fn(async () => null),
      };
      return new BaseDevice({
        device: dev('Y'),
        region: 'eu',
        sessionRef: args.sessionRef,
        fetchInitialValues: false,
        deps: baseDeps,
      });
    };
    const deps = makeDeps({ createDevice });
    const n = new Nodreame({ username: 'a@b.c', password: 'pw', region: 'eu' }, deps);
    await n.discoverDevices();
    await n.close();
    expect(closed).toEqual([true, true]);
    expect(n.devices).toHaveLength(0);
  });
});
