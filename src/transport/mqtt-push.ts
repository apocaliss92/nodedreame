import mqtt from 'mqtt';
import type { DreameRegion } from '../auth/config.js';
import type { DreameDevice, DreameSession } from '../cloud/types.js';
import { DreameTransportError } from './errors.js';
import { randomMqttClientId } from './crypto.js';
import { TypedEmitter } from './typed-emitter.js';
import { RawMqttEventSchema } from './schemas.js';

/** A single property update pushed by the device. */
export interface PropertyChange {
  did: string;
  siid: number;
  piid: number;
  value: unknown;
}

/** MIoT event push (`method: "event_occured"` — yes, the typo is on the wire). */
export interface EventOccuredPush {
  did: string;
  siid: number;
  eiid: number;
  arguments: unknown[];
}

/** Untyped k/v push on `method: "props"` (OTA progress/state, etc.). */
export interface PropsPush {
  did: string;
  params: Record<string, unknown>;
}

/** Saved-map catalogue push on `_sync.update_vacuum_mapinfo`. */
export interface MapInfoPush {
  did: string;
  maps: Map<number, readonly number[]>;
  activeMapId: number | null;
  savedMapIds: readonly number[];
}

/**
 * The subset of `mqtt.MqttClient` this module uses. Declaring it lets tests
 * inject a fake broker without depending on a live TLS socket.
 */
export interface MqttLikeClient {
  on(event: 'connect', cb: () => void): this;
  on(event: 'close', cb: () => void): this;
  on(event: 'error', cb: (err: Error) => void): this;
  on(event: 'message', cb: (topic: string, payload: Buffer) => void): this;
  once(event: 'connect', cb: () => void): this;
  once(event: 'error', cb: (err: Error) => void): this;
  removeListener(event: string, cb: (...args: never[]) => void): this;
  subscribe(topic: string, opts: { qos: 0 | 1 | 2 }, cb: (err?: Error) => void): void;
  end(force: boolean, opts: Record<string, never>, cb: () => void): void;
}

export interface ConnectOptions {
  username: string;
  password: string;
  clientId: string;
  protocolVersion: 4;
  reconnectPeriod: number;
  connectTimeout: number;
  rejectUnauthorized: boolean;
  clean: boolean;
}

/** Factory matching `mqtt.connect`'s shape we rely on (injectable for tests). */
export type MqttConnectFn = (url: string, opts: ConnectOptions) => MqttLikeClient;

function defaultConnect(url: string, opts: ConnectOptions): MqttLikeClient {
  // mqtt.connect returns a MqttClient which structurally satisfies MqttLikeClient.
  // We verify this with a local type assertion through the interface rather than
  // a raw cast, keeping the boundary explicit.
  const client = mqtt.connect(url, opts);
  // MqttClient implements the full MqttLikeClient contract; assign through the
  // interface to surface any future structural mismatch as a compile error.
  const typed: MqttLikeClient = client;
  return typed;
}

export type DreamePushEvents = {
  properties: [PropertyChange[]];
  event: [EventOccuredPush];
  props: [PropsPush];
  mapInfo: [MapInfoPush];
  connect: [];
  close: [];
  error: [Error];
};

export interface DreamePushInput {
  device: DreameDevice;
  session: DreameSession;
  region: DreameRegion;
  /** Injectable mqtt.connect (defaults to the real one). */
  connect?: MqttConnectFn;
  /** Backoff before a reconnect attempt after an unexpected drop. Default 5000. */
  reconnectBackoffMs?: number;
}

/**
 * Durable per-device MQTT subscription. Unlike the donor, this:
 *  - reconnects with backoff after an unexpected drop, then resubscribes;
 *  - on `refreshSession(newSession)` closes the old client and reopens with
 *    the new access token (the broker validates the token at CONNECT only and
 *    cannot be re-authed on a live client);
 *  - never auto-reconnects after an explicit `close()`.
 */
export class DreamePush extends TypedEmitter<DreamePushEvents> {
  readonly #device: DreameDevice;
  #session: DreameSession;
  readonly #region: DreameRegion;
  readonly #connect: MqttConnectFn;
  readonly #backoffMs: number;
  readonly #topic: string;
  #client: MqttLikeClient | null = null;
  #closed = false;
  #tearingDown = false;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Per-instance bound close handler. Stored so we can pass the EXACT same
   * function reference to both `client.on('close', …)` and
   * `client.removeListener('close', …)` during teardown — a throwaway arrow
   * would be a different reference and would NOT be removed.
   */
  readonly #onClose: () => void;

  constructor(input: DreamePushInput) {
    super();
    this.#device = input.device;
    this.#session = input.session;
    this.#region = input.region;
    this.#connect = input.connect ?? defaultConnect;
    this.#backoffMs = input.reconnectBackoffMs ?? 5000;
    this.#topic = buildStatusTopic(this.#device, this.#session.uid, this.#region);
    // Bind once so the reference is stable across register/remove calls.
    this.#onClose = (): void => {
      if (this.#tearingDown) {
        // We caused this close (teardown or refresh). Do NOT reconnect.
        return;
      }
      this.emit('close');
      this.#scheduleReconnect();
    };
  }

  get topic(): string {
    return this.#topic;
  }

  /** Open the connection and resolve when subscribed. */
  async open(): Promise<void> {
    if (this.#closed) {
      throw new DreameTransportError('subscription is closed');
    }
    if (this.#client) {
      return;
    }
    await this.#connectAndSubscribe();
  }

  /**
   * Swap to a freshly-refreshed session: close the current client and reopen
   * with the new access token. Safe to call while connected or disconnected.
   */
  async refreshSession(session: DreameSession): Promise<void> {
    this.#session = session;
    if (this.#closed) {
      return;
    }
    await this.#teardownClient();
    await this.#connectAndSubscribe();
  }

  /** Tear down permanently. Closed subscriptions cannot be reopened. */
  async close(): Promise<void> {
    this.#closed = true;
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    await this.#teardownClient();
  }

  async #connectAndSubscribe(): Promise<void> {
    const client = this.#connect(brokerUrl(this.#device), {
      username: this.#session.uid,
      password: this.#session.accessToken,
      clientId: randomMqttClientId(),
      protocolVersion: 4,
      reconnectPeriod: 0, // we drive reconnect ourselves
      connectTimeout: 15000,
      rejectUnauthorized: false,
      clean: true,
    });
    this.#client = client;

    client.on('message', (_topic, payload) => this.#handleMessage(payload));
    client.on('error', (err) => this.emit('error', err));
    // Use the stored bound reference so teardown can reliably remove it.
    client.on('close', this.#onClose);

    await new Promise<void>((resolve, reject) => {
      const onConnect = (): void => {
        client.removeListener('error', onError);
        client.subscribe(this.#topic, { qos: 0 }, (err) => {
          if (err) {
            reject(new DreameTransportError(`mqtt subscribe failed: ${err.message}`, err));
            return;
          }
          this.emit('connect');
          resolve();
        });
      };
      const onError = (err: Error): void => {
        client.removeListener('connect', onConnect);
        reject(new DreameTransportError(`mqtt connect failed: ${err.message}`, err));
      };
      client.once('connect', onConnect);
      client.once('error', onError);
    });
  }

  #scheduleReconnect(): void {
    if (this.#closed || this.#reconnectTimer) {
      return;
    }
    this.#client = null;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      if (this.#closed) {
        return;
      }
      void this.#connectAndSubscribe().catch((err: unknown) => {
        this.emit('error', err instanceof Error ? err : new DreameTransportError(String(err)));
        this.#scheduleReconnect();
      });
    }, this.#backoffMs);
  }

  async #teardownClient(): Promise<void> {
    const client = this.#client;
    this.#client = null;
    if (!client) {
      return;
    }
    // Signal to #onClose that this close event is intentional — do not reconnect.
    this.#tearingDown = true;
    // Remove the stored bound reference. This is the exact function object
    // registered in #connectAndSubscribe, so removeListener works correctly.
    client.removeListener('close', this.#onClose);
    await new Promise<void>((resolve) => {
      client.end(false, {}, () => resolve());
    });
    this.#tearingDown = false;
  }

  #handleMessage(payload: Buffer): void {
    let raw: unknown;
    try {
      raw = JSON.parse(payload.toString('utf8'));
    } catch (err) {
      this.emit('error', new DreameTransportError('invalid mqtt payload', err));
      return;
    }
    const result = RawMqttEventSchema.safeParse(raw);
    if (!result.success) {
      this.emit('error', new DreameTransportError('unexpected mqtt envelope'));
      return;
    }
    const envelope = result.data;
    const did = String(envelope.did ?? this.#device.did);
    const method = envelope.data?.method;
    const params = envelope.data?.params;

    if (method === 'properties_changed' && Array.isArray(params)) {
      const changes = parsePropertyChanges(did, params);
      if (changes.length > 0) {
        this.emit('properties', changes);
      }
      return;
    }
    if (method === 'event_occured' && isObject(params)) {
      const ev = parseEventOccured(did, params);
      if (ev) {
        this.emit('event', ev);
      }
      return;
    }
    if (method === 'props' && isObject(params)) {
      this.emit('props', { did, params });
      return;
    }
    if (method === '_sync.update_vacuum_mapinfo' && isObject(params)) {
      const mi = parseMapInfo(did, params);
      if (mi) {
        this.emit('mapInfo', mi);
      }
      return;
    }
  }
}

// --- Pure helpers (exported for unit tests) ------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function brokerUrl(device: DreameDevice): string {
  const bindDomain = (device.raw['bindDomain'] as string | undefined) ?? '';
  if (!bindDomain) {
    throw new DreameTransportError(`device ${device.did} has no bindDomain — cannot connect MQTT`);
  }
  return `mqtts://${bindDomain}`;
}

export function buildStatusTopic(device: DreameDevice, uid: string, region: DreameRegion): string {
  // Trailing slash is mandatory — the broker matches it literally.
  return `/status/${device.did}/${uid}/${device.model}/${region}/`;
}

export function parsePropertyChanges(fallbackDid: string, params: unknown[]): PropertyChange[] {
  const changes: PropertyChange[] = [];
  for (const p of params) {
    if (!isObject(p)) {
      continue;
    }
    const siid = p['siid'];
    const piid = p['piid'];
    if (typeof siid === 'number' && typeof piid === 'number') {
      const did = p['did'];
      changes.push({
        did: typeof did === 'string' || typeof did === 'number' ? String(did) : fallbackDid,
        siid,
        piid,
        value: p['value'],
      });
    }
  }
  return changes;
}

export function parseEventOccured(
  fallbackDid: string,
  params: Record<string, unknown>,
): EventOccuredPush | null {
  const siid = params['siid'];
  const eiid = params['eiid'];
  if (typeof siid !== 'number' || typeof eiid !== 'number') {
    return null;
  }
  const did = params['did'];
  const args = params['arguments'];
  return {
    did: typeof did === 'string' || typeof did === 'number' ? String(did) : fallbackDid,
    siid,
    eiid,
    arguments: Array.isArray(args) ? args : [],
  };
}

export function parseMapInfo(
  fallbackDid: string,
  params: Record<string, unknown>,
): MapInfoPush | null {
  const inner = params['map_info'];
  if (typeof inner !== 'string') {
    return null;
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(inner);
  } catch {
    return null;
  }
  if (!isObject(decoded)) {
    return null;
  }
  const maps = new Map<number, readonly number[]>();
  for (const [key, value] of Object.entries(decoded)) {
    const id = Number(key);
    if (!Number.isFinite(id) || !Array.isArray(value)) {
      continue;
    }
    maps.set(
      id,
      value.filter((v): v is number => typeof v === 'number'),
    );
  }
  let activeMapId: number | null = null;
  for (const [id, tok] of [...maps].sort((a, b) => a[0] - b[0])) {
    if (tok.length > 1 || (tok.length === 1 && tok[0] !== 0)) {
      activeMapId = id;
      break;
    }
  }
  const savedMapIds = Object.freeze([...maps.keys()].sort((a, b) => a - b));
  const did = params['did'];
  return {
    did: typeof did === 'string' || typeof did === 'number' ? String(did) : fallbackDid,
    maps,
    activeMapId,
    savedMapIds,
  };
}
