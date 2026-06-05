import type { DreameRegion } from '../auth/config.js';
import type {
  DreameDevice,
  DreameSession,
  MiotProp,
  PropertyResult,
  PropertyWrite,
} from '../cloud/types.js';
import {
  callAction as defaultCallAction,
  getProperties as defaultGetProperties,
  getCachedProperties as defaultGetCachedProperties,
  setProperties as defaultSetProperties,
  type CommonInput,
} from '../cloud/commands.js';
import { DreamePush, type PropertyChange } from '../transport/mqtt-push.js';
import { DreameTransportError } from '../transport/errors.js';
import { TypedEmitter } from '../transport/typed-emitter.js';
import { DefaultCapabilityResolver, type DeviceCapabilities } from './capability.js';
import type {
  DeviceEvent,
  PropertyChangedEvent,
  PropertyState,
  StateChangedEvent,
} from '../api/types.js';

/**
 * The slice of {@link DreamePush} that {@link BaseDevice} depends on. Declaring
 * it as an interface lets tests inject a fake emitter with no casts; the real
 * `DreamePush` structurally satisfies it.
 */
export interface PushLike {
  on(event: 'properties', cb: (changes: PropertyChange[]) => void): this;
  on(
    event: 'event',
    cb: (ev: { did: string; siid: number; eiid: number; arguments: unknown[] }) => void,
  ): this;
  on(event: 'connect', cb: () => void): this;
  on(event: 'close', cb: () => void): this;
  on(event: 'error', cb: (err: Error) => void): this;
  open(): Promise<void>;
  close(): Promise<void>;
  refreshSession(session: DreameSession): Promise<void>;
}

/** Injectable collaborators — defaults wire the real transport + command layer. */
export interface BaseDeviceDeps {
  createPush(device: DreameDevice, session: DreameSession, region: DreameRegion): PushLike;
  getProperties(base: CommonInput, props: MiotProp[]): Promise<PropertyResult[]>;
  /** Read the cloud-cached (shadow) values WITHOUT waking the device. */
  getCachedProperties(base: CommonInput, props: MiotProp[]): Promise<PropertyResult[]>;
  setProperties(base: CommonInput, writes: PropertyWrite[]): Promise<PropertyResult[]>;
  callAction(
    base: CommonInput,
    action: { siid: number; aiid: number; in?: unknown[] },
  ): Promise<unknown>;
}

/** Default deps using the real `DreamePush` and `src/cloud/commands.ts`. */
export function defaultBaseDeviceDeps(): BaseDeviceDeps {
  return {
    createPush: (device, session, region) => new DreamePush({ device, session, region }),
    getProperties: (base, props) => defaultGetProperties(base, props),
    getCachedProperties: (base, props) => defaultGetCachedProperties(base, props),
    setProperties: (base, writes) => defaultSetProperties(base, writes),
    callAction: (base, action) => defaultCallAction(base, action),
  };
}

export type BaseDeviceEvents = {
  propertyChanged: [PropertyChangedEvent];
  stateChanged: [StateChangedEvent];
  event: [DeviceEvent];
  error: [Error];
};

export interface BaseDeviceInput {
  device: DreameDevice;
  region: DreameRegion;
  /** Always reads the LATEST session — the facade owns the variable. */
  sessionRef: () => DreameSession;
  deps?: BaseDeviceDeps;
  /** Eager-seed the cache on `start()`. Default true. */
  fetchInitialValues?: boolean;
  /** Properties to seed when `fetchInitialValues` is true. Default `[]`. */
  initialProps?: MiotProp[];
  /** Poll interval (ms) while MQTT is down. Default 30000; 0 disables. */
  pollIntervalMs?: number;
  /** Capability set (defaults to the no-op resolver). */
  capabilities?: DeviceCapabilities;
}

const DEFAULT_POLL_INTERVAL_MS = 30000;

/**
 * A device-type-agnostic live handle for one Dreame device.
 *
 * Generic over its event map so subclasses can WIDEN the typed emitter with
 * their own events (e.g. the vacuum's `'map'` event) without a banned cast.
 * `Events` is constrained to extend {@link BaseDeviceEvents} so every internal
 * `emit(...)` call stays type-safe, and it defaults to {@link BaseDeviceEvents}
 * so a bare `BaseDevice` reference behaves exactly as before.
 */
export class BaseDevice<
  Events extends BaseDeviceEvents = BaseDeviceEvents,
> extends TypedEmitter<Events> {
  readonly #device: DreameDevice;
  readonly #region: DreameRegion;
  readonly #sessionRef: () => DreameSession;
  readonly #deps: BaseDeviceDeps;
  readonly #fetchInitial: boolean;
  readonly #initialProps: MiotProp[];
  readonly #pollIntervalMs: number;
  readonly #capabilities: DeviceCapabilities;
  readonly #cache = new Map<string, PropertyState>();
  #push: PushLike | null = null;
  #mqttHealthy = false;
  #pollTimer: ReturnType<typeof setInterval> | null = null;
  #closed = false;

  constructor(input: BaseDeviceInput) {
    super();
    this.#device = input.device;
    this.#region = input.region;
    this.#sessionRef = input.sessionRef;
    this.#deps = input.deps ?? defaultBaseDeviceDeps();
    this.#fetchInitial = input.fetchInitialValues ?? true;
    this.#initialProps = input.initialProps ?? [];
    this.#pollIntervalMs = input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.#capabilities =
      input.capabilities ?? new DefaultCapabilityResolver().resolve(input.device.model);
  }

  get deviceId(): string {
    return this.#device.did;
  }

  get model(): string {
    return this.#device.model;
  }

  get name(): string {
    return this.#device.name;
  }

  get capabilities(): DeviceCapabilities {
    return this.#capabilities;
  }

  /** Snapshot of all cached property states. */
  get properties(): readonly PropertyState[] {
    return [...this.#cache.values()];
  }

  /** Read a cached property, or `undefined` if never observed. */
  getProperty(siid: number, piid: number): PropertyState | undefined {
    return this.#cache.get(key(siid, piid));
  }

  #base(): CommonInput {
    return { session: this.#sessionRef(), region: this.#region, did: this.#device.did };
  }

  /** The region this handle is bound to. Subclasses use it to build map fetches. */
  protected get region(): DreameRegion {
    return this.#region;
  }

  /** Latest session snapshot. Subclasses use it for out-of-band fetches (maps). */
  protected currentSession(): DreameSession {
    return this.#sessionRef();
  }

  /** Open the push, wire events, optionally seed the cache. */
  async start(): Promise<void> {
    const push = this.#deps.createPush(this.#device, this.#sessionRef(), this.#region);
    this.#push = push;
    push.on('properties', (changes) => this.#onProperties(changes));
    push.on('event', (ev) =>
      this.emit('event', {
        deviceId: ev.did || this.#device.did,
        siid: ev.siid,
        eiid: ev.eiid,
        arguments: ev.arguments,
      }),
    );
    push.on('error', (err) => this.emit('error', err));
    push.on('connect', () => this.#onMqttUp());
    push.on('close', () => this.#onMqttDown());
    await push.open();
    this.#onMqttUp();
    if (this.#fetchInitial && this.#initialProps.length > 0) {
      await this.refreshProperties(this.#initialProps);
    }
  }

  /** Live-read properties, update the cache, return the raw results. */
  async refreshProperties(props: MiotProp[]): Promise<PropertyResult[]> {
    this.#assertOpen();
    const results = await this.#deps.getProperties(this.#base(), props);
    this.#seedFromResults(results);
    return results;
  }

  /**
   * Read the CLOUD-CACHED (shadow) values of `props` WITHOUT waking the device,
   * update the cache, and emit `propertyChanged`/`stateChanged` just like
   * {@link refreshProperties} — but sourced from the cloud shadow endpoint, so
   * it works for standby/offline robots (and never surfaces a false 80001).
   */
  async refreshCachedProperties(props: MiotProp[]): Promise<PropertyResult[]> {
    this.#assertOpen();
    const results = await this.#deps.getCachedProperties(this.#base(), props);
    this.#seedFromResults(results);
    return results;
  }

  /** Mirror a PropertyResult[] into the cache + emit the change events. */
  #seedFromResults(results: PropertyResult[]): void {
    const changes: PropertyChange[] = [];
    for (const r of results) {
      if (typeof r.siid === 'number' && typeof r.piid === 'number') {
        changes.push({ did: this.#device.did, siid: r.siid, piid: r.piid, value: r.value });
      }
    }
    if (changes.length > 0) {
      this.#onProperties(changes);
    }
  }

  /** Write a property to the device. */
  async setProperty(write: PropertyWrite): Promise<PropertyResult[]> {
    this.#assertOpen();
    return this.#deps.setProperties(this.#base(), [write]);
  }

  /** Invoke a MIoT action on the device. */
  async callAction(siid: number, aiid: number, input: unknown[] = []): Promise<unknown> {
    this.#assertOpen();
    return this.#deps.callAction(this.#base(), { siid, aiid, in: input });
  }

  /** Guard against use after {@link close}. */
  #assertOpen(): void {
    if (this.#closed) {
      throw new DreameTransportError('device handle is closed');
    }
  }

  /** Propagate a refreshed session to the underlying push. */
  async applySession(session: DreameSession): Promise<void> {
    if (this.#push) {
      await this.#push.refreshSession(session);
    }
  }

  /** Tear down: stop polling, close the push. */
  async close(): Promise<void> {
    this.#closed = true;
    this.#stopPolling();
    const push = this.#push;
    this.#push = null;
    if (push) {
      await push.close();
    }
    this.removeAllListeners();
  }

  #onProperties(changes: PropertyChange[]): void {
    const emitted: PropertyChangedEvent[] = [];
    const now = Date.now();
    for (const c of changes) {
      const k = key(c.siid, c.piid);
      const previous = this.#cache.get(k);
      this.#cache.set(k, { siid: c.siid, piid: c.piid, value: c.value, updatedAt: now });
      const ev: PropertyChangedEvent = {
        deviceId: this.#device.did,
        siid: c.siid,
        piid: c.piid,
        value: c.value,
        previousValue: previous ? previous.value : null,
      };
      emitted.push(ev);
      this.emit('propertyChanged', ev);
    }
    if (emitted.length > 0) {
      this.emit('stateChanged', { deviceId: this.#device.did, changes: emitted });
    }
  }

  #onMqttUp(): void {
    this.#mqttHealthy = true;
    this.#stopPolling();
  }

  #onMqttDown(): void {
    this.#mqttHealthy = false;
    this.#startPolling();
  }

  #startPolling(): void {
    if (this.#closed || this.#pollTimer || this.#pollIntervalMs <= 0) {
      return;
    }
    if (this.#initialProps.length === 0) {
      return;
    }
    this.#pollTimer = setInterval(() => {
      if (this.#mqttHealthy) {
        this.#stopPolling();
        return;
      }
      void this.refreshProperties(this.#initialProps).catch((err: unknown) => {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      });
    }, this.#pollIntervalMs);
  }

  #stopPolling(): void {
    if (this.#pollTimer) {
      clearInterval(this.#pollTimer);
      this.#pollTimer = null;
    }
  }
}

function key(siid: number, piid: number): string {
  return `${siid}.${piid}`;
}
