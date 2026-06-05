import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  DreamePush,
  brokerUrl,
  buildStatusTopic,
  parsePropertyChanges,
  parseEventOccured,
  parseMapInfo,
} from '../../src/transport/mqtt-push.js';
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
}
class FakeClient extends EventEmitter {
  subscribed: string[] = [];
  ended = false;
  constructor(
    public url: string,
    public opts: FakeOpts,
  ) {
    super();
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

  it('rejects open() when subscribe reports an error', async () => {
    const created: FailingSubscribeClient[] = [];
    const connect = (url: string, opts: FakeOpts): FailingSubscribeClient => {
      const c = new FailingSubscribeClient(url, opts);
      created.push(c);
      queueMicrotask(() => c.goConnected());
      return c;
    };
    const push = new DreamePush({ device, session: session('T'), region: 'eu', connect });
    await expect(push.open()).rejects.toThrow(/subscribe failed/);
  });

  it('rejects open() when the broker errors before connect', async () => {
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
