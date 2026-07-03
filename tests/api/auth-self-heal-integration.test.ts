import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Nodreame } from '../../src/api/nodreame.js';
import type { NodreameDeps, CreateDeviceArgs } from '../../src/api/nodreame.js';
import { BaseDevice } from '../../src/device/base-device.js';
import type { BaseDeviceDeps } from '../../src/device/base-device.js';
import { DreamePush } from '../../src/transport/mqtt-push.js';
import type { DreameDevice, DreameSession } from '../../src/cloud/types.js';

/**
 * INTEGRATION test wiring the REAL Nodreame facade + REAL BaseDevice + REAL
 * DreamePush (only the mqtt socket and the login/refresh HTTP are faked). It
 * exercises the anti-double-connect / propagation-isolation guarantees that a
 * bare `onAuthFailure` mock cannot reach: when ONE device's `refreshSession`
 * fails during the fleet-wide propagation of a re-authed token, the healthy
 * sibling must NOT be orphaned and no spurious full re-login may occur.
 */

const session = (token: string, expiresAt = Date.now() + 1_000_000): DreameSession => ({
  accessToken: token,
  refreshToken: 'RT',
  uid: 'UID',
  expiresAt,
  region: 'eu',
});

const dev = (did: string, host: string): DreameDevice => ({
  did,
  model: 'dreame.vacuum.r2532a',
  name: did,
  online: true,
  raw: { bindDomain: host },
});

interface FakeOpts {
  username?: string;
  password?: string;
}

class FakeClient extends EventEmitter {
  subscribed: string[] = [];
  ended = false;
  dropped = false;
  constructor(
    public url: string,
    public opts: FakeOpts,
  ) {
    super();
  }
  get isLive(): boolean {
    return !this.ended && !this.dropped;
  }
  override removeListener(event: string, cb: (...args: never[]) => void): this {
    super.removeListener(event, cb as (...args: unknown[]) => void);
    return this;
  }
  subscribe(topic: string, _opts: unknown, cb: (err?: Error) => void): void {
    this.subscribed.push(topic);
    cb();
  }
  end(_force: boolean, _opts: unknown, cb: () => void): void {
    this.ended = true;
    cb();
  }
  goConnected(): void {
    this.emit('connect');
  }
  drop(): void {
    this.dropped = true;
    this.emit('close');
  }
  /** CONNACK rc=5 — triggers the reactive auth self-heal. */
  failAuth(): void {
    const e = new Error('Connection refused: Not authorized') as Error & { code: number };
    e.code = 5;
    this.emit('error', e);
  }
  /** A non-auth transient error — should drive a plain backoff reconnect. */
  failTransient(): void {
    this.emit('error', new Error('ECONNRESET'));
  }
}

/**
 * A fake fleet broker keyed by connection URL (each device has a distinct
 * bindDomain). `validToken` models the server-side accepted token; a URL in
 * `failTransientOnce` fails its NEXT connect with a non-auth error exactly once.
 */
function makeFleetBroker() {
  const created: FakeClient[] = [];
  const broker = { validToken: 'T1' };
  const failTransientOnce = new Set<string>();
  const connect = (url: string, opts: FakeOpts): FakeClient => {
    const c = new FakeClient(url, opts);
    created.push(c);
    queueMicrotask(() => {
      if (failTransientOnce.has(url)) {
        failTransientOnce.delete(url);
        c.failTransient();
        return;
      }
      if (opts.password === broker.validToken) {
        c.goConnected();
      } else {
        c.failAuth();
      }
    });
    return c;
  };
  return { connect, created, broker, failTransientOnce };
}

describe('Nodreame — fleet auth self-heal integration (propagation isolation)', () => {
  it("one device's propagation failure orphans no healthy sibling and triggers no spurious re-login", async () => {
    vi.useFakeTimers();
    try {
      const { connect, created, broker, failTransientOnce } = makeFleetBroker();
      const login = vi.fn(async () => session('T1'));
      const refresh = vi.fn(async () => session('T2'));
      const listDevices = vi.fn(async () => [dev('D1', 'b1:1'), dev('D2', 'b2:1')]);
      const createDevice = (args: CreateDeviceArgs): BaseDevice => {
        const baseDeps: BaseDeviceDeps = {
          createPush: (device, sess, region, onAuthFailure) =>
            new DreamePush({
              device,
              session: sess,
              region,
              connect,
              reconnectBackoffMs: 10,
              ...(onAuthFailure ? { onAuthFailure } : {}),
            }),
          getProperties: vi.fn(async () => []),
          getCachedProperties: vi.fn(async () => []),
          setProperties: vi.fn(async () => []),
          callAction: vi.fn(async () => null),
        };
        return new BaseDevice({ ...args, fetchInitialValues: false, deps: baseDeps });
      };
      const deps: NodreameDeps = { login, refresh, listDevices, createDevice };

      const n = new Nodreame({ username: 'a@b.c', password: 'pw', region: 'eu' }, deps);
      n.on('error', () => {}); // swallow forwarded transport errors

      const openP = n.discoverDevices();
      await vi.advanceTimersByTimeAsync(0); // flush the initial connects
      await openP;

      // Both devices connected exactly once on the initial token.
      expect(created.filter((c) => c.url === 'mqtts://b1:1')).toHaveLength(1);
      expect(created.filter((c) => c.url === 'mqtts://b2:1')).toHaveLength(1);

      // Server-side token invalidation. D1 drops → its reconnect is auth-refused,
      // triggering the fleet re-auth. D2's reconnect on the NEW token fails once
      // (transient) DURING the propagation — the scenario under test.
      broker.validToken = 'T2';
      failTransientOnce.add('mqtts://b2:1');
      created.find((c) => c.url === 'mqtts://b1:1')!.drop();

      await vi.advanceTimersByTimeAsync(200);

      // (3) No spurious full re-login: login ran only for the initial session;
      // the re-auth used the refresh-token grant exactly once.
      expect(login).toHaveBeenCalledTimes(1);
      expect(refresh).toHaveBeenCalledTimes(1);

      // (1) The healthy device keeps EXACTLY ONE live client on the new token —
      // no orphaned socket, no duplicate connection.
      const d1Live = created.filter((c) => c.url === 'mqtts://b1:1' && c.isLive);
      expect(d1Live).toHaveLength(1);
      expect(d1Live[0]!.opts.password).toBe('T2');

      // (2) The failing device recovered via a bounded reconnect — exactly ONE
      // live client on the new token (not left dark).
      const d2Live = created.filter((c) => c.url === 'mqtts://b2:1' && c.isLive);
      expect(d2Live).toHaveLength(1);
      expect(d2Live[0]!.opts.password).toBe('T2');

      // Fleet-wide: exactly two live clients (one per device) — no leaks.
      expect(created.filter((c) => c.isLive)).toHaveLength(2);

      await n.close();
    } finally {
      vi.useRealTimers();
    }
  });
});
