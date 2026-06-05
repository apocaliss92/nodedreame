import type { DreameRegion } from '../auth/config.js';
import type { FetchImpl } from '../transport/http.js';

/** Options for constructing a {@link Nodreame} facade. */
export interface NodreameOptions {
  /** Account email / username for the Dreamehome cloud. */
  username: string;
  /** Account password (hashed client-side before transmission). */
  password: string;
  /** Dreame cloud region. */
  region: DreameRegion;
  /** ISO-3166 alpha-2 country override (defaults from region). */
  country?: string;
  /** ISO-639-1 language override (defaults from region). */
  lang?: string;
  /**
   * Brand tenant. Reserved for Mova devices; Phase 2 only wires Dreame, so this
   * is accepted but not yet branched on. Defaults to `'dreame'`.
   */
  accountType?: 'dreame' | 'mova';
  /**
   * Seconds before access-token expiry at which the session is proactively
   * refreshed. Defaults to 100 (parity with the donor client).
   */
  refreshLeewaySecs?: number;
  /**
   * Poll interval (ms) used as a fallback when a device's MQTT push is down.
   * Defaults to 30000. Set to 0 to disable poll fallback entirely.
   */
  pollIntervalMs?: number;
  /**
   * Whether each device should eagerly seed its property cache on construction
   * via a `get_properties` read. Defaults to `true` (opt-out).
   */
  fetchInitialValues?: boolean;
  /** Inject a fetch implementation (testing/advanced). */
  fetchImpl?: FetchImpl;
}

/** One cached property value plus when it was last observed. */
export interface PropertyState {
  siid: number;
  piid: number;
  value: unknown;
  /** Epoch-ms of the last update (push or live read). */
  updatedAt: number;
}

/** Emitted when a single property changes (cache delta). */
export interface PropertyChangedEvent {
  deviceId: string;
  siid: number;
  piid: number;
  value: unknown;
  /** Prior cached value, or `null` if the property was previously unknown. */
  previousValue: unknown;
}

/** Emitted once per push batch, aggregating all property changes in it. */
export interface StateChangedEvent {
  deviceId: string;
  changes: PropertyChangedEvent[];
}

/** Emitted on a device MIoT event (`event_occured`). */
export interface DeviceEvent {
  deviceId: string;
  siid: number;
  eiid: number;
  arguments: unknown[];
}
