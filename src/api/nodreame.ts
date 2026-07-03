import type { DreameRegion } from '../auth/config.js';
import type { DreameDevice, DreameSession } from '../cloud/types.js';
import { login as defaultLogin, refresh as defaultRefresh } from '../auth/dreame-account.js';
import { listDevices as defaultListDevices } from '../cloud/devices.js';
import { BaseDevice } from '../device/base-device.js';
import { VacuumDevice } from '../models/vacuum/vacuum-device.js';
import { MowerDevice } from '../models/mower/mower-device.js';
import { TypedEmitter } from '../transport/typed-emitter.js';
import { DreameAuthError } from '../transport/errors.js';
import type { FetchImpl } from '../transport/http.js';
import type { NodreameOptions, DeviceEvent, StateChangedEvent } from './types.js';

const DEFAULT_REFRESH_LEEWAY_SECS = 100;

/**
 * Device-type factory: pick the handle class by model prefix. Returns a
 * `BaseDevice` constructor (`VacuumDevice` / `MowerDevice` are subtypes, so the
 * return is covariant and needs no cast).
 */
export function deviceClassFor(model: string): typeof BaseDevice {
  if (model.startsWith('dreame.vacuum.')) {
    return VacuumDevice;
  }
  if (model.startsWith('dreame.mower.')) {
    return MowerDevice;
  }
  return BaseDevice;
}

/** Args the facade passes to `createDevice` (a seam for tests). */
export interface CreateDeviceArgs {
  device: DreameDevice;
  region: DreameRegion;
  sessionRef: () => DreameSession;
  /**
   * Force-refresh callback handed down to the device's MQTT push so it can
   * self-heal a broker CONNACK auth-refusal (stale token). Bound by the facade
   * to {@link Nodreame.reauthenticate}.
   */
  onAuthFailure?: () => Promise<DreameSession>;
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
    createDevice: (args) => {
      const DeviceClass = deviceClassFor(args.device.model);
      return new DeviceClass({
        device: args.device,
        region: args.region,
        sessionRef: args.sessionRef,
        ...(args.onAuthFailure !== undefined ? { onAuthFailure: args.onAuthFailure } : {}),
        ...(opts.fetchInitialValues !== undefined
          ? { fetchInitialValues: opts.fetchInitialValues }
          : {}),
        ...(opts.pollIntervalMs !== undefined ? { pollIntervalMs: opts.pollIntervalMs } : {}),
      });
    },
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
  /** Background timer that proactively refreshes before the token expires. */
  #refreshTimer: ReturnType<typeof setTimeout> | null = null;
  /** Guard against overlapping proactive-refresh runs. */
  #refreshInFlight = false;
  /**
   * The single in-flight refresh, shared by concurrent callers so the proactive
   * timer and a manual `ensureSession()`/`reauthenticate()` never double-refresh.
   */
  #inFlightRefresh: Promise<DreameSession> | null = null;

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
    // Arm the proactive refresh against this session's expiry.
    this.#scheduleProactiveRefresh();
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
    return this.#refreshNow(current);
  }

  /**
   * Force a session refresh REGARDLESS of the current expiry, then propagate the
   * new token to every live device push. Wired as each push's `onAuthFailure`:
   * when a broker refuses a CONNECT because it considers the token stale (even
   * though {@link ensureSession} still thinks it valid — e.g. server-side early
   * revocation or clock skew), this mints a genuinely fresh token instead of
   * replaying the rejected one.
   */
  async reauthenticate(): Promise<DreameSession> {
    if (this.#closed) {
      throw new DreameAuthError('client is closed');
    }
    const current = this.#session;
    if (!current) {
      return this.login();
    }
    return this.#refreshNow(current);
  }

  /**
   * Refresh via the refresh-token (with a full re-login fallback) and propagate
   * the new token to every device push. Shared by {@link ensureSession} (within
   * the leeway window) and {@link reauthenticate} (unconditional).
   */
  async #refreshNow(current: DreameSession): Promise<DreameSession> {
    // Coalesce concurrent refreshes (background timer + manual call) into one.
    const existing = this.#inFlightRefresh;
    if (existing) {
      return existing;
    }
    const run = this.#doRefresh(current);
    this.#inFlightRefresh = run;
    try {
      return await run;
    } finally {
      this.#inFlightRefresh = null;
    }
  }

  async #doRefresh(current: DreameSession): Promise<DreameSession> {
    if (current.refreshToken) {
      // Narrow scope: the full-re-login fallback must cover ONLY a failed
      // refresh-token GRANT — never the subsequent propagation. If we let the
      // catch swallow a propagation failure it would trigger a spurious full
      // re-login (and, in the fleet, tear down healthy siblings).
      let next: DreameSession | null = null;
      try {
        next = await this.#deps.refresh({
          refreshToken: current.refreshToken,
          region: this.#opts.region,
          ...(this.#opts.country !== undefined ? { country: this.#opts.country } : {}),
          ...(this.#opts.lang !== undefined ? { lang: this.#opts.lang } : {}),
          ...(this.#opts.fetchImpl !== undefined ? { fetchImpl: this.#opts.fetchImpl } : {}),
        });
      } catch {
        next = null; // fall through to a full re-login
      }
      if (next) {
        await this.#adoptSession(next);
        return next;
      }
    }
    const fresh = await this.login();
    await this.#propagateSession(fresh);
    return fresh;
  }

  /** Discover devices and build a live handle per device. */
  async discoverDevices(): Promise<readonly BaseDevice[]> {
    if (this.#closed) {
      throw new DreameAuthError('client is closed');
    }
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
        onAuthFailure: () => this.reauthenticate(),
      }),
    );
    for (const h of handles) {
      h.on('stateChanged', (e) => this.emit('stateChanged', e));
      h.on('event', (e) => this.emit('event', e));
      // Guard the forward-emit: reactive re-auth / cap-exhaustion failures now
      // funnel through here. An unhandled 'error' on the emitter throws, which
      // would crash a consumer that never attached an 'error' listener.
      h.on('error', (err) => {
        if (this.listenerCount('error') > 0) {
          this.emit('error', err);
        }
      });
      await h.start();
    }
    // Close any handles from a previous discovery before adopting the new set —
    // each holds an open MQTT push + a poll timer that would otherwise leak.
    const previous = this.#devices;
    this.#devices = [...handles];
    await Promise.all(previous.map((d) => d.close()));
    // Re-arm the proactive refresh against the session used for this discovery.
    this.#scheduleProactiveRefresh();
    return this.#devices;
  }

  /** Tear everything down: close every device push and clear timers. */
  async close(): Promise<void> {
    this.#closed = true;
    this.#clearRefreshTimer();
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
    this.#scheduleProactiveRefresh();
  }

  #clearRefreshTimer(): void {
    if (this.#refreshTimer) {
      clearTimeout(this.#refreshTimer);
      this.#refreshTimer = null;
    }
  }

  /** Arm the proactive-refresh timer `delayMs` from now (clamped to ≥0). */
  #armRefreshTimer(delayMs: number): void {
    this.#clearRefreshTimer();
    if (this.#closed) {
      return;
    }
    this.#refreshTimer = setTimeout(() => {
      this.#refreshTimer = null;
      void this.#runProactiveRefresh();
    }, Math.max(0, delayMs));
  }

  /** (Re)arm the proactive-refresh timer against the current session's expiry. */
  #scheduleProactiveRefresh(): void {
    const session = this.#session;
    if (!session) {
      this.#clearRefreshTimer();
      return;
    }
    this.#armRefreshTimer(session.expiresAt - this.#leewayMs - Date.now());
  }

  /**
   * Timer body: refresh the session before it expires, then reschedule against
   * the new expiry. Because {@link ensureSession} propagates the refreshed token
   * to every device push, each MQTT connection is re-keyed BEFORE the broker
   * would reject the old one — the reactive re-auth loop never even starts.
   */
  async #runProactiveRefresh(): Promise<void> {
    if (this.#closed || this.#refreshInFlight) {
      return;
    }
    this.#refreshInFlight = true;
    try {
      await this.ensureSession();
      this.#refreshInFlight = false;
      // Track the newest expiry (ensureSession may have returned the current
      // session unchanged if the clock had not yet crossed the boundary).
      this.#scheduleProactiveRefresh();
    } catch (err) {
      this.#refreshInFlight = false;
      // Surface only when someone is listening — an unhandled 'error' on the
      // emitter would throw. The failure is transient; the retry below recovers.
      if (this.listenerCount('error') > 0) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      }
      // Retry after a bounded backoff rather than hot-looping on a still-expiring
      // session (whose boundary is already in the past ⇒ a 0ms reschedule).
      if (!this.#closed) {
        this.#armRefreshTimer(this.#leewayMs);
      }
    }
  }

  /** Push the refreshed token to every live device push. */
  async #propagateSession(session: DreameSession): Promise<void> {
    if (this.#closed) {
      return;
    }
    // allSettled — NOT all: one device's applySession failure must NEVER reject
    // the whole propagation. A rejected Promise.all here would (1) orphan the
    // healthy siblings that already reconnected, (2) bubble up into #doRefresh
    // and trigger a spurious full re-login, and (3) reach the originating push's
    // reauth catch and tear down its live client. Each device self-heals its own
    // reconnect (see DreamePush.refreshSession), so per-device failures are
    // isolated here.
    await Promise.allSettled(this.#devices.map((d) => d.applySession(session)));
  }
}
