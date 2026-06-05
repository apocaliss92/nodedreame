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
