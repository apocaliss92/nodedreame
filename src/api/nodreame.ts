import type { DreameRegion } from '../auth/config.js';
import type { DreameDevice, DreameSession } from '../cloud/types.js';
import { login as defaultLogin, refresh as defaultRefresh } from '../auth/dreame-account.js';
import { listDevices as defaultListDevices } from '../cloud/devices.js';
import { BaseDevice } from '../device/base-device.js';
import { TypedEmitter } from '../transport/typed-emitter.js';
import { DreameAuthError } from '../transport/errors.js';
import type { FetchImpl } from '../transport/http.js';
import type { NodreameOptions, DeviceEvent, StateChangedEvent } from './types.js';

const DEFAULT_REFRESH_LEEWAY_SECS = 100;

/** Args the facade passes to `createDevice` (a seam for tests). */
export interface CreateDeviceArgs {
  device: DreameDevice;
  region: DreameRegion;
  sessionRef: () => DreameSession;
}

/** Injectable collaborators — defaults wire the real P1 modules. */
export interface NodreameDeps {
  login(input: {
    email: string;
    password: string;
    region: DreameRegion;
    country?: string;
    lang?: string;
    fetchImpl?: FetchImpl;
  }): Promise<DreameSession>;
  refresh(input: {
    refreshToken: string;
    region: DreameRegion;
    country?: string;
    lang?: string;
    fetchImpl?: FetchImpl;
  }): Promise<DreameSession>;
  listDevices(input: {
    session: DreameSession;
    region: DreameRegion;
    fetchImpl?: FetchImpl;
  }): Promise<DreameDevice[]>;
  createDevice(args: CreateDeviceArgs): BaseDevice;
}

function defaultDeps(opts: NodreameOptions): NodreameDeps {
  return {
    login: (input) => defaultLogin(input),
    refresh: (input) => defaultRefresh(input),
    listDevices: (input) => defaultListDevices(input),
    createDevice: (args) =>
      new BaseDevice({
        device: args.device,
        region: args.region,
        sessionRef: args.sessionRef,
        ...(opts.fetchInitialValues !== undefined
          ? { fetchInitialValues: opts.fetchInitialValues }
          : {}),
        ...(opts.pollIntervalMs !== undefined ? { pollIntervalMs: opts.pollIntervalMs } : {}),
      }),
  };
}

export type NodreameEvents = {
  /** Re-emitted device state change, tagged with the deviceId. */
  stateChanged: [StateChangedEvent];
  /** Re-emitted device event, tagged with the deviceId. */
  event: [DeviceEvent];
  error: [Error];
};

/** Public facade for the Dreamehome cloud. */
export class Nodreame extends TypedEmitter<NodreameEvents> {
  readonly #opts: NodreameOptions;
  readonly #deps: NodreameDeps;
  readonly #leewayMs: number;
  #session: DreameSession | null = null;
  #devices: BaseDevice[] = [];
  #closed = false;

  constructor(opts: NodreameOptions, deps?: NodreameDeps) {
    super();
    if (!opts.username || !opts.password) {
      throw new DreameAuthError('username and password are required');
    }
    this.#opts = opts;
    this.#deps = deps ?? defaultDeps(opts);
    this.#leewayMs = (opts.refreshLeewaySecs ?? DEFAULT_REFRESH_LEEWAY_SECS) * 1000;
  }

  get region(): DreameRegion {
    return this.#opts.region;
  }

  get session(): DreameSession | null {
    return this.#session;
  }

  get devices(): readonly BaseDevice[] {
    return this.#devices;
  }

  /** Authenticate and stash the single shared session. */
  async login(): Promise<DreameSession> {
    this.#session = await this.#deps.login({
      email: this.#opts.username,
      password: this.#opts.password,
      region: this.#opts.region,
      ...(this.#opts.country !== undefined ? { country: this.#opts.country } : {}),
      ...(this.#opts.lang !== undefined ? { lang: this.#opts.lang } : {}),
      ...(this.#opts.fetchImpl !== undefined ? { fetchImpl: this.#opts.fetchImpl } : {}),
    });
    return this.#session;
  }

  /** Return a valid session, refreshing proactively within the leeway window. */
  async ensureSession(): Promise<DreameSession> {
    const current = this.#session;
    if (!current) {
      return this.login();
    }
    if (Date.now() < current.expiresAt - this.#leewayMs) {
      return current;
    }
    if (current.refreshToken) {
      try {
        const next = await this.#deps.refresh({
          refreshToken: current.refreshToken,
          region: this.#opts.region,
          ...(this.#opts.country !== undefined ? { country: this.#opts.country } : {}),
          ...(this.#opts.lang !== undefined ? { lang: this.#opts.lang } : {}),
          ...(this.#opts.fetchImpl !== undefined ? { fetchImpl: this.#opts.fetchImpl } : {}),
        });
        await this.#adoptSession(next);
        return next;
      } catch {
        // fall through to a full re-login
      }
    }
    const fresh = await this.login();
    await this.#propagateSession(fresh);
    return fresh;
  }

  /** Discover devices and build a live handle per device. */
  async discoverDevices(): Promise<readonly BaseDevice[]> {
    const session = await this.ensureSession();
    const records = await this.#deps.listDevices({
      session,
      region: this.#opts.region,
      ...(this.#opts.fetchImpl !== undefined ? { fetchImpl: this.#opts.fetchImpl } : {}),
    });
    const handles = records.map((device) =>
      this.#deps.createDevice({
        device,
        region: this.#opts.region,
        sessionRef: () => this.#requireSession(),
      }),
    );
    for (const h of handles) {
      h.on('stateChanged', (e) => this.emit('stateChanged', e));
      h.on('event', (e) => this.emit('event', e));
      h.on('error', (err) => this.emit('error', err));
      await h.start();
    }
    this.#devices = [...handles];
    return this.#devices;
  }

  /** Tear everything down: close every device push and clear timers. */
  async close(): Promise<void> {
    this.#closed = true;
    const devices = this.#devices;
    this.#devices = [];
    await Promise.all(devices.map((d) => d.close()));
    this.removeAllListeners();
  }

  #requireSession(): DreameSession {
    if (!this.#session) {
      throw new DreameAuthError('no active session — call login() first');
    }
    return this.#session;
  }

  async #adoptSession(session: DreameSession): Promise<void> {
    this.#session = session;
    await this.#propagateSession(session);
  }

  /** Push the refreshed token to every live device push. */
  async #propagateSession(session: DreameSession): Promise<void> {
    if (this.#closed) {
      return;
    }
    await Promise.all(this.#devices.map((d) => d.applySession(session)));
  }
}
