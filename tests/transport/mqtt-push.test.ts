import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  DreamePush,
  brokerUrl,
  buildStatusTopic,
  isAuthRefusedError,
  parsePropertyChanges,
  parseEventOccured,
  parseMapInfo,
} from '../../src/transport/mqtt-push.js';
import { DreameTransportError } from '../../src/transport/errors.js';
import type { DreameDevice, DreameSession } from '../../src/cloud/types.js';

const device: DreameDevice = {
  did: 'DID',
  model: 'dreame.vacuum.r2532a',
  name: 'Vac',
  online: true,
  raw: { bindDomain: '10000.mt.eu.iot.dreame.tech:19973' },
};

const session = (token: string): DreameSession => ({
  accessToken: token,
  uid: 'UID',
  expiresAt: Date.now() + 1e6,
  region: 'eu',
});

// --- Fake mqtt client + connect factory --------------------------------
interface FakeOpts {
  username?: string;
  password?: string;
  clientId?: string;
  rejectUnauthorized?: boolean;
  keepalive?: number;
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
  /** A client is a live connection only if it neither dropped nor was ended. */
  get isLive(): boolean {
    return !this.ended && !this.dropped;
  }
  // Narrow EventEmitter#removeListener to the MqttLikeClient-compatible
  // signature so the fake structurally satisfies the injected connect factory.
  // Type-only override — runtime behaviour is inherited from EventEmitter.
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
  // test helpers
  goConnected(): void {
    this.emit('connect');
  }
  pushJson(obj: unknown): void {
    this.emit('message', '/topic', Buffer.from(JSON.stringify(obj)));
  }
  drop(): void {
    this.dropped = true;
    this.emit('close');
  }
}

const makeFactory = () => {
  const created: FakeClient[] = [];
  const connect = (url: string, opts: FakeOpts): FakeClient => {
    const c = new FakeClient(url, opts);
    created.push(c);
    // emit connect on next tick so open()'s once('connect') is wired first
    queueMicrotask(() => c.goConnected());
    return c;
  };
  return { connect, created };
};

describe('pure helpers', () => {
  it('brokerUrl + topic build correctly', () => {
    expect(brokerUrl(device)).toBe('mqtts://10000.mt.eu.iot.dreame.tech:19973');
    expect(buildStatusTopic(device, 'UID', 'eu')).toBe('/status/DID/UID/dreame.vacuum.r2532a/eu/');
  });

  it('parsePropertyChanges flattens an array push', () => {
    const changes = parsePropertyChanges('DID', [
      { did: 'DID', siid: 2, piid: 6, value: 1 },
      { siid: 3, piid: 1, value: 80 },
      { siid: 'x' }, // ignored
    ]);
    expect(changes).toEqual([
      { did: 'DID', siid: 2, piid: 6, value: 1 },
      { did: 'DID', siid: 3, piid: 1, value: 80 },
    ]);
  });

  it('parseEventOccured + parseMapInfo', () => {
    expect(parseEventOccured('DID', { siid: 4, eiid: 1, arguments: [1] })).toEqual({
      did: 'DID',
      siid: 4,
      eiid: 1,
      arguments: [1],
    });
    const mi = parseMapInfo('DID', { map_info: JSON.stringify({ '1': [5, 10], '2': [0] }) });
    expect(mi?.savedMapIds).toEqual([1, 2]);
    expect(mi?.activeMapId).toBe(1);
  });
});

describe('isAuthRefusedError (CONNACK auth-refusal detector)', () => {
  it('detects MQTT 3.1.1 / MQTT 5 auth reason codes and message text', () => {
    // MQTT 3.1.1 CONNACK codes (protocolVersion 4): 4 bad creds, 5 not authorized.
    expect(isAuthRefusedError(Object.assign(new Error('x'), { code: 5 }))).toBe(true);
    expect(isAuthRefusedError(Object.assign(new Error('x'), { code: 4 }))).toBe(true);
    // MQTT 5 CONNACK reason codes: 134 bad user/pass, 135 not authorized.
    expect(isAuthRefusedError(Object.assign(new Error('x'), { code: 135 }))).toBe(true);
    // Wrapped by DreameTransportError (cause chain).
    const wrapped = new DreameTransportError(
      'mqtt connect failed: Connection refused: Not authorized',
      Object.assign(new Error('Connection refused: Not authorized'), { code: 5 }),
    );
    expect(isAuthRefusedError(wrapped)).toBe(true);
    // Message-only detection (no numeric code).
    expect(isAuthRefusedError(new Error('Connection refused: Bad username or password'))).toBe(
      true,
    );
  });

  it('does NOT flag non-auth errors', () => {
    expect(isAuthRefusedError(new Error('ECONNRESET'))).toBe(false);
    expect(isAuthRefusedError(Object.assign(new Error('server unavailable'), { code: 3 }))).toBe(
      false,
    );
    expect(isAuthRefusedError(null)).toBe(false);
    expect(isAuthRefusedError(undefined)).toBe(false);
  });
});

describe('DreamePush — rejectUnauthorized option', () => {
  it('defaults rejectUnauthorized to false', async () => {
    const { connect, created } = makeFactory();
    const push = new DreamePush({ device, session: session('T'), region: 'eu', connect });
    await push.open();
    expect(created[0]!.opts.rejectUnauthorized).toBe(false);
    await push.close();
  });

  it('propagates rejectUnauthorized:true into the connect options', async () => {
    const { connect, created } = makeFactory();
    const push = new DreamePush({
      device,
      session: session('T'),
      region: 'eu',
      connect,
      rejectUnauthorized: true,
    });
    await push.open();
    expect(created[0]!.opts.rejectUnauthorized).toBe(true);
    await push.close();
  });
});

describe('DreamePush — connect + subscribe', () => {
  it('connects with uid/token and subscribes to the status topic', async () => {
    const { connect, created } = makeFactory();
    const push = new DreamePush({ device, session: session('TOK1'), region: 'eu', connect });
    await push.open();
    const c = created[0]!;
    expect(c.url).toBe('mqtts://10000.mt.eu.iot.dreame.tech:19973');
    expect(c.opts.username).toBe('UID');
    expect(c.opts.password).toBe('TOK1');
    expect(c.opts.rejectUnauthorized).toBe(false);
    expect(c.subscribed).toEqual(['/status/DID/UID/dreame.vacuum.r2532a/eu/']);
    await push.close();
    expect(c.ended).toBe(true);
  });

  it('emits parsed properties from a properties_changed push', async () => {
    const { connect, created } = makeFactory();
    const push = new DreamePush({ device, session: session('TOK1'), region: 'eu', connect });
    const onProps = vi.fn();
    push.on('properties', onProps);
    await push.open();
    created[0]!.pushJson({
      did: 'DID',
      data: {
        method: 'properties_changed',
        params: [{ did: 'DID', siid: 2, piid: 6, value: 1 }],
      },
    });
    expect(onProps).toHaveBeenCalledWith([{ did: 'DID', siid: 2, piid: 6, value: 1 }]);
    await push.close();
  });
});

describe('DreamePush — durable reconnect', () => {
  it('reconnects after an unexpected drop and resubscribes', async () => {
    const { connect, created } = makeFactory();
    const push = new DreamePush({
      device,
      session: session('TOK1'),
      region: 'eu',
      connect,
      reconnectBackoffMs: 0, // immediate for the test
    });
    await push.open();
    expect(created).toHaveLength(1);
    created[0]!.drop();
    // allow the backoff (0ms) + reconnect microtasks to run
    await vi.waitFor(() => expect(created.length).toBe(2));
    expect(created[1]!.subscribed).toEqual(['/status/DID/UID/dreame.vacuum.r2532a/eu/']);
    await push.close();
  });

  it('refreshSession() closes the old client and reopens with the new token', async () => {
    const { connect, created } = makeFactory();
    const push = new DreamePush({ device, session: session('OLD'), region: 'eu', connect });
    await push.open();
    expect(created[0]!.opts.password).toBe('OLD');
    await push.refreshSession(session('NEW'));
    expect(created[0]!.ended).toBe(true);
    expect(created).toHaveLength(2);
    expect(created[1]!.opts.password).toBe('NEW');
    expect(created[1]!.subscribed).toEqual(['/status/DID/UID/dreame.vacuum.r2532a/eu/']);
    await push.close();
  });

  it('refreshSession() before an armed reconnect timer fires leaves exactly one live client on the new token', async () => {
    vi.useFakeTimers();
    try {
      const { connect, created } = makeFactory();
      const push = new DreamePush({
        device,
        session: session('OLD'),
        region: 'eu',
        connect,
        reconnectBackoffMs: 5000, // non-zero so the drop arms a pending timer
      });
      const openPromise = push.open();
      await vi.advanceTimersByTimeAsync(0); // flush the queued goConnected microtask
      await openPromise;
      expect(created).toHaveLength(1);

      // Unexpected drop arms the reconnect timer (does NOT fire yet).
      created[0]!.drop();
      expect(created).toHaveLength(1);

      // refreshSession runs BEFORE the armed timer fires: it tears down the old
      // client and reconnects on the new token.
      const refreshPromise = push.refreshSession(session('NEW'));
      await vi.advanceTimersByTimeAsync(0); // flush refresh's goConnected microtask
      await refreshPromise;

      // Now let the stale reconnect timer's backoff elapse. It must NOT spawn a
      // second live client.
      await vi.advanceTimersByTimeAsync(10000);

      // Exactly one live client: the refresh's, on the NEW token. The original
      // client dropped; no orphaned extra client from the stale timer.
      const live = created.filter((c) => c.isLive);
      expect(live).toHaveLength(1);
      expect(live[0]!.opts.password).toBe('NEW');
      expect(created[0]!.isLive).toBe(false);

      await push.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not reconnect after an explicit close()', async () => {
    const { connect, created } = makeFactory();
    const push = new DreamePush({
      device,
      session: session('TOK1'),
      region: 'eu',
      connect,
      reconnectBackoffMs: 0,
    });
    await push.open();
    await push.close();
    created[0]!.drop();
    await new Promise((r) => setTimeout(r, 5));
    expect(created).toHaveLength(1);
  });
});

// --- Auth-refused reconnect fake (reactive self-heal) ------------------
class AuthAwareClient extends EventEmitter {
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
  /** Simulate a CONNACK with return code 5 ("Not authorized"). */
  failAuth(): void {
    const e = new Error('Connection refused: Not authorized') as Error & { code: number };
    e.code = 5;
    this.emit('error', e);
  }
}

/**
 * A fake broker that accepts exactly ONE token: a CONNECT whose password matches
 * `broker.validToken` connects; otherwise the broker answers CONNACK rc=5. This
 * models an access token going stale server-side (rotate `broker.validToken`).
 */
function makeAuthFactory(initialValidToken: string) {
  const created: AuthAwareClient[] = [];
  const broker = { validToken: initialValidToken };
  const connect = (url: string, opts: FakeOpts): AuthAwareClient => {
    const c = new AuthAwareClient(url, opts);
    created.push(c);
    queueMicrotask(() => {
      if (opts.password === broker.validToken) {
        c.goConnected();
      } else {
        c.failAuth();
      }
    });
    return c;
  };
  return { connect, created, broker };
}

describe('DreamePush — reactive auth self-heal (FIX B)', () => {
  it('re-authenticates on a CONNACK auth-refusal and reconnects with the NEW token', async () => {
    const { connect, created, broker } = makeAuthFactory('T1');
    const onAuthFailure = vi.fn(async () => session('T2'));
    const push = new DreamePush({
      device,
      session: session('T1'),
      region: 'eu',
      connect,
      reconnectBackoffMs: 0,
      onAuthFailure,
    });
    push.on('error', vi.fn()); // swallow the surfaced transport errors
    await push.open();
    expect(created).toHaveLength(1);
    expect(created[0]!.opts.password).toBe('T1');

    // The access token rotates server-side and the live connection drops.
    broker.validToken = 'T2';
    created[0]!.drop();

    // The stale-token reconnect is refused → onAuthFailure() mints a new session →
    // the push reconnects with the NEW token (never loops on the old one).
    await vi.waitFor(() => expect(onAuthFailure).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => {
      const live = created.filter((c) => c.isLive);
      expect(live).toHaveLength(1);
      expect(live[0]!.opts.password).toBe('T2');
    });
    await push.close();
  });

  it('caps consecutive auth re-auths so bad credentials do not hot-loop re-login', async () => {
    vi.useFakeTimers();
    try {
      const { connect, created, broker } = makeAuthFactory('T1');
      // onAuthFailure keeps returning a token the broker also rejects — the
      // "genuinely bad credentials" case. The re-auth must be capped.
      const onAuthFailure = vi.fn(async () => session('STILL-STALE'));
      const errors: Error[] = [];
      const push = new DreamePush({
        device,
        session: session('T1'),
        region: 'eu',
        connect,
        reconnectBackoffMs: 1000,
        maxAuthRetries: 3,
        onAuthFailure,
      });
      push.on('error', (e) => errors.push(e));

      const openP = push.open();
      await vi.advanceTimersByTimeAsync(0); // flush the queued goConnected
      await openP;

      // Rotate so the current token (and onAuthFailure's token) are now rejected.
      broker.validToken = 'ROTATED';
      created[0]!.drop(); // arm the reconnect (backoff 1000)

      // One backoff elapse drives the full strike burst: each failed connect →
      // onAuthFailure → immediate (no-backoff) re-attempt → fail → … until the cap.
      await vi.advanceTimersByTimeAsync(1000);
      expect(onAuthFailure).toHaveBeenCalledTimes(3);

      // Past the cap it must NOT keep re-logging-in; further reconnects use the
      // plain backoff path only (no more onAuthFailure calls).
      await vi.advanceTimersByTimeAsync(1000);
      expect(onAuthFailure).toHaveBeenCalledTimes(3);
      expect(errors.length).toBeGreaterThan(0);

      await push.close();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('DreamePush — message routing', () => {
  it('emits event/props/mapInfo for each push method', async () => {
    const { connect, created } = makeFactory();
    const push = new DreamePush({ device, session: session('T'), region: 'eu', connect });
    const onEvent = vi.fn();
    const onProps = vi.fn();
    const onMap = vi.fn();
    push.on('event', onEvent);
    push.on('props', onProps);
    push.on('mapInfo', onMap);
    await push.open();
    const c = created[0]!;

    c.pushJson({
      did: 'DID',
      data: { method: 'event_occured', params: { siid: 4, eiid: 1, arguments: [9] } },
    });
    expect(onEvent).toHaveBeenCalledWith({ did: 'DID', siid: 4, eiid: 1, arguments: [9] });

    c.pushJson({ did: 'DID', data: { method: 'props', params: { ota_state: 'updating' } } });
    expect(onProps).toHaveBeenCalledWith({ did: 'DID', params: { ota_state: 'updating' } });

    c.pushJson({
      did: 'DID',
      data: {
        method: '_sync.update_vacuum_mapinfo',
        params: { map_info: JSON.stringify({ '1': [5, 10], '2': [0] }) },
      },
    });
    expect(onMap).toHaveBeenCalledTimes(1);

    await push.close();
  });

  it('uses the device did as a fallback when the envelope omits it', async () => {
    const { connect, created } = makeFactory();
    const push = new DreamePush({ device, session: session('T'), region: 'eu', connect });
    const onProps = vi.fn();
    push.on('properties', onProps);
    await push.open();
    created[0]!.pushJson({
      data: { method: 'properties_changed', params: [{ siid: 2, piid: 6, value: 1 }] },
    });
    expect(onProps).toHaveBeenCalledWith([{ did: 'DID', siid: 2, piid: 6, value: 1 }]);
    await push.close();
  });

  it('emits error on invalid JSON and on an unexpected envelope without crashing', async () => {
    const { connect, created } = makeFactory();
    const push = new DreamePush({ device, session: session('T'), region: 'eu', connect });
    const onError = vi.fn();
    push.on('error', onError);
    await push.open();
    const c = created[0]!;
    c.emit('message', '/topic', Buffer.from('not-json{'));
    c.emit('message', '/topic', Buffer.from(JSON.stringify(42)));
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(Error);
    await push.close();
  });

  it('ignores unknown methods and empty property pushes', async () => {
    const { connect, created } = makeFactory();
    const push = new DreamePush({ device, session: session('T'), region: 'eu', connect });
    const onProps = vi.fn();
    const onEvent = vi.fn();
    push.on('properties', onProps);
    push.on('event', onEvent);
    await push.open();
    const c = created[0]!;
    c.pushJson({ did: 'DID', data: { method: 'unknown_method', params: { x: 1 } } });
    c.pushJson({ did: 'DID', data: { method: 'properties_changed', params: [{ siid: 'x' }] } });
    expect(onProps).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
    await push.close();
  });
});

describe('DreamePush — lifecycle edge cases', () => {
  it('exposes the status topic and is idempotent on a second open()', async () => {
    const { connect, created } = makeFactory();
    const push = new DreamePush({ device, session: session('T'), region: 'eu', connect });
    expect(push.topic).toBe('/status/DID/UID/dreame.vacuum.r2532a/eu/');
    await push.open();
    await push.open();
    expect(created).toHaveLength(1);
    await push.close();
  });

  it('throws when open() is called after close()', async () => {
    const { connect } = makeFactory();
    const push = new DreamePush({ device, session: session('T'), region: 'eu', connect });
    await push.open();
    await push.close();
    await expect(push.open()).rejects.toThrow();
  });

  it('refreshSession() after close() is a no-op', async () => {
    const { connect, created } = makeFactory();
    const push = new DreamePush({ device, session: session('OLD'), region: 'eu', connect });
    await push.open();
    await push.close();
    await push.refreshSession(session('NEW'));
    expect(created).toHaveLength(1);
  });

  it('close() before open() resolves without error', async () => {
    const { connect, created } = makeFactory();
    const push = new DreamePush({ device, session: session('T'), region: 'eu', connect });
    await push.close();
    expect(created).toHaveLength(0);
  });

  it('rejects open() when subscribe reports an error AND ends the client (no orphan)', async () => {
    const created: FailingSubscribeClient[] = [];
    const connect = (url: string, opts: FakeOpts): FailingSubscribeClient => {
      const c = new FailingSubscribeClient(url, opts);
      created.push(c);
      queueMicrotask(() => c.goConnected());
      return c;
    };
    const push = new DreamePush({ device, session: session('T'), region: 'eu', connect });
    await expect(push.open()).rejects.toThrow(/subscribe failed/);
    // The failed client must be torn down — otherwise its (possibly ESTABLISHED)
    // socket leaks once the caller nulls the reference.
    expect(created).toHaveLength(1);
    expect(created[0]!.ended).toBe(true);
  });

  it('rejects open() when the broker errors before connect AND ends the client (no orphan)', async () => {
    const created: ErroringClient[] = [];
    const connect = (url: string, opts: FakeOpts): ErroringClient => {
      const c = new ErroringClient(url, opts);
      created.push(c);
      queueMicrotask(() => c.emit('error', new Error('tls handshake failed')));
      return c;
    };
    const push = new DreamePush({ device, session: session('T'), region: 'eu', connect });
    push.on('error', vi.fn());
    await expect(push.open()).rejects.toThrow(/connect failed/);
    expect(created).toHaveLength(1);
    expect(created[0]!.ended).toBe(true);
  });

  it('keep-alive defaults to 60s and is passed to the mqtt client (library-side)', async () => {
    const { connect, created } = makeFactory();
    const push = new DreamePush({ device, session: session('T'), region: 'eu', connect });
    await push.open();
    expect(created[0]!.opts.keepalive).toBe(60);
    await push.close();
  });

  it('honours a custom keepaliveSeconds', async () => {
    const { connect, created } = makeFactory();
    const push = new DreamePush({
      device,
      session: session('T'),
      region: 'eu',
      connect,
      keepaliveSeconds: 30,
    });
    await push.open();
    expect(created[0]!.opts.keepalive).toBe(30);
    await push.close();
  });
});

describe('pure helper edge cases', () => {
  it('brokerUrl throws when bindDomain is missing', () => {
    const noDomain: DreameDevice = { ...device, raw: {} };
    expect(() => brokerUrl(noDomain)).toThrow(/bindDomain/);
  });

  it('parseEventOccured returns null on a malformed event', () => {
    expect(parseEventOccured('DID', { siid: 'x' })).toBeNull();
  });

  it('parseMapInfo returns null on a non-string / invalid map_info', () => {
    expect(parseMapInfo('DID', {})).toBeNull();
    expect(parseMapInfo('DID', { map_info: 'not-json{' })).toBeNull();
    expect(parseMapInfo('DID', { map_info: JSON.stringify([1, 2]) })).toBeNull();
  });

  it('parseMapInfo reports no active map when every entry is [0]', () => {
    const mi = parseMapInfo('DID', { map_info: JSON.stringify({ '3': [0], '4': [0] }) });
    expect(mi?.activeMapId).toBeNull();
    expect(mi?.savedMapIds).toEqual([3, 4]);
  });
});

class FailingSubscribeClient extends EventEmitter {
  subscribed: string[] = [];
  ended = false;
  constructor(
    public url: string,
    public opts: FakeOpts,
  ) {
    super();
  }
  override removeListener(event: string, cb: (...args: never[]) => void): this {
    super.removeListener(event, cb as (...args: unknown[]) => void);
    return this;
  }
  subscribe(_topic: string, _opts: unknown, cb: (err?: Error) => void): void {
    cb(new Error('boom'));
  }
  end(_force: boolean, _opts: unknown, cb: () => void): void {
    this.ended = true;
    cb();
  }
  goConnected(): void {
    this.emit('connect');
  }
}

class ErroringClient extends EventEmitter {
  ended = false;
  constructor(
    public url: string,
    public opts: FakeOpts,
  ) {
    super();
  }
  override removeListener(event: string, cb: (...args: never[]) => void): this {
    super.removeListener(event, cb as (...args: unknown[]) => void);
    return this;
  }
  subscribe(_topic: string, _opts: unknown, cb: (err?: Error) => void): void {
    cb();
  }
  end(_force: boolean, _opts: unknown, cb: () => void): void {
    this.ended = true;
    cb();
  }
}
