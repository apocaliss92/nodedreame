/**
 * Autonomous cold-start of a Dreame vacuum camera stream.
 *
 * Reproduces the exact sequence the r2538z (X50) app runs when you open the
 * camera — verified end-to-end against a deep-cold device:
 *
 *   1. getAccessCodeLaunch  (aiid 4 / piid 1100 {open:true})  — primes the pipeline
 *   2. initCameraSdk        (aiid 7 / piid 11   {})           — boots the on-device video agent
 *   3. startMonitor         (aiid 1 / piid 1    …start)       — on code:-1 with a PIN set,
 *      verifyAccessCode     (aiid 4 / piid 1102 sha256(PIN))  — satisfy the privacy gate,
 *      startMonitor (retry)                                    — now accepted (code:0 + encryptionKey)
 *   4. keep_alive loop      (aiid 1 / piid 6)                 — every ~10s, or the device tears down
 *   5. stream/query (Aliyun LinkVisual)                        — mint the plain RTMP relay URL
 *
 * The resulting relay URL is a standard RTMP stream (H.264 + AAC) any consumer
 * (scrypted / camstack / ffmpeg) can pull directly. Call {@link close} to stop
 * the keep-alive loop and release the monitor on the device.
 */
import { DreameError } from '../../transport/errors.js';
import { MONITOR_AIID, MONITOR_PIID, MONITOR_SIID } from './constants.js';
import {
  accessCodeLaunchParams,
  actionCode,
  buildActionInput,
  fillLightParams,
  firstOutValue,
  intercomStartParams,
  intercomStopParams,
  keepAliveParams,
  makeMonitorSession,
  startMonitorParams,
  stopMonitorParams,
  verifyAccessCodeParams,
} from './protocol.js';

/** Minimal MIoT action caller — satisfied by a nodedreame device handle. */
export interface MonitorActionCaller {
  callAction(siid: number, aiid: number, input: unknown[]): Promise<unknown>;
}

/** Minimal relay minter — satisfied by {@link DreameVideoSession}. */
export interface RelayMinter {
  getStreamInfo(
    iotId: string,
    opts?: { encrypted?: boolean; wakeTimeoutMs?: number; pollMs?: number },
  ): Promise<{ relayUrl: string | null }>;
}

export interface DreameCameraControllerInput {
  /** MIoT action transport (the device handle). */
  readonly device: MonitorActionCaller;
  /** Aliyun relay minter (a {@link DreameVideoSession}). */
  readonly relay: RelayMinter;
  /** LinkVisual channel id for this device (`iotId`). */
  readonly iotId: string;
  /** Dreame account uid — seeds the per-session correlation token. */
  readonly accountId: string;
  /** Video vendor. Only `ali` mints an RTMP relay; defaults to `ali`. */
  readonly vendor?: 'ali' | 'tx';
  /** Privacy access code (PIN) set at pairing, if any. Required to wake a coded camera. */
  readonly accessCode?: string;
  /** Aliyun region code the device reports as `area`; defaults to `'4'`. */
  readonly area?: string;
  /** Keep-alive cadence in ms (app default 10s). */
  readonly keepAliveIntervalMs?: number;
  /** Max time to wait for the relay to come up while the device wakes. */
  readonly wakeTimeoutMs?: number;
  /** Reported when a keep-alive tick fails (the stream is likely dying). */
  readonly onKeepAliveError?: (err: unknown) => void;
}

/** A live camera stream: the pullable relay URL plus the device's per-stream key. */
export interface CameraStreamHandle {
  /** Plain RTMP relay URL (H.264 + AAC). Single stream; re-open for another consumer. */
  readonly rtmpUrl: string;
  /** Device-generated per-session encryption key echoed by `startMonitor`. */
  readonly encryptionKey: string | null;
}

const DEFAULT_KEEP_ALIVE_MS = 10_000;
const DEFAULT_AREA = '4';

export class DreameCameraController {
  readonly #device: MonitorActionCaller;
  readonly #relay: RelayMinter;
  readonly #iotId: string;
  readonly #accountId: string;
  readonly #vendor: 'ali' | 'tx';
  readonly #accessCode: string | undefined;
  readonly #area: string;
  readonly #keepAliveIntervalMs: number;
  readonly #wakeTimeoutMs: number | undefined;
  readonly #onKeepAliveError: ((err: unknown) => void) | undefined;

  #session: string | null = null;
  #keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  #opened = false;

  constructor(input: DreameCameraControllerInput) {
    this.#device = input.device;
    this.#relay = input.relay;
    this.#iotId = input.iotId;
    this.#accountId = input.accountId;
    this.#vendor = input.vendor ?? 'ali';
    this.#accessCode = input.accessCode;
    this.#area = input.area ?? DEFAULT_AREA;
    this.#keepAliveIntervalMs = input.keepAliveIntervalMs ?? DEFAULT_KEEP_ALIVE_MS;
    this.#wakeTimeoutMs = input.wakeTimeoutMs;
    this.#onKeepAliveError = input.onKeepAliveError;
  }

  /** True while a monitor session is active (between {@link open} and {@link close}). */
  get isOpen(): boolean {
    return this.#opened;
  }

  /** Send one camera action, resolving to the raw device reply. */
  async #action(aiid: number, piid: number, params: Record<string, unknown> | null): Promise<unknown> {
    if (!this.#session) {
      throw new DreameError('camera controller has no session; call open() first');
    }
    const input = buildActionInput(piid, params, this.#session);
    return this.#device.callAction(MONITOR_SIID, aiid, [input]);
  }

  /**
   * Run the full cold-start sequence and return a live relay URL. Starts the
   * keep-alive loop; the caller MUST {@link close} when done to release the
   * device. Throws if the monitor cannot be started or no relay comes up.
   */
  async open(): Promise<CameraStreamHandle> {
    if (this.#opened) {
      throw new DreameError('camera stream already open');
    }
    this.#session = makeMonitorSession(this.#accountId);

    // 1) Prime the pipeline + boot the on-device video agent (best-effort:
    // failures here are non-fatal, startMonitor is the real gate).
    await this.#tryPrime();

    // 2) startMonitor — retry once behind the privacy gate if refused.
    const startRes = await this.#startMonitorWithGate();
    const encryptionKey = asString(firstOutValue(startRes));

    // 3) keep the monitor alive from now on (device tears down without it).
    this.#opened = true;
    this.#startKeepAlive();

    // 4) mint the relay (transparently retries while the device wakes).
    let relayUrl: string | null;
    try {
      const info = await this.#relay.getStreamInfo(this.#iotId, {
        encrypted: false,
        ...(this.#wakeTimeoutMs !== undefined ? { wakeTimeoutMs: this.#wakeTimeoutMs } : {}),
      });
      relayUrl = info.relayUrl;
    } catch (err) {
      await this.close();
      throw err;
    }
    if (!relayUrl) {
      await this.close();
      throw new DreameError('monitor started but no relay URL was returned');
    }

    return { rtmpUrl: relayUrl, encryptionKey };
  }

  async #tryPrime(): Promise<void> {
    try {
      await this.#action(MONITOR_AIID.ACCESS_CODE_OPERATE, MONITOR_PIID.GET_ACCESS_CODE, accessCodeLaunchParams());
    } catch {
      /* non-fatal */
    }
    try {
      await this.#action(MONITOR_AIID.VIDEO_VENDOR, MONITOR_PIID.VIDEO_VENDOR_STATUS, null);
    } catch {
      /* non-fatal */
    }
  }

  async #startMonitorWithGate(): Promise<unknown> {
    const params = startMonitorParams(this.#iotId, this.#vendor, this.#area);
    let res = await this.#action(MONITOR_AIID.CAMERA_OPERATE, MONITOR_PIID.MONITOR_STATUS, params);
    if (actionCode(res) === 0) {
      return res;
    }
    // Refused: the camera's per-session privacy gate needs the PIN verified.
    if (this.#accessCode) {
      await this.#action(
        MONITOR_AIID.ACCESS_CODE_OPERATE,
        MONITOR_PIID.VERIFY_ACCESS_CODE,
        verifyAccessCodeParams(this.#accessCode),
      );
      res = await this.#action(MONITOR_AIID.CAMERA_OPERATE, MONITOR_PIID.MONITOR_STATUS, params);
    }
    if (actionCode(res) !== 0) {
      const code = actionCode(res);
      throw new DreameError(
        `startMonitor refused (code ${code ?? '?'})` +
          (this.#accessCode ? '' : '; device likely requires an accessCode'),
      );
    }
    return res;
  }

  #startKeepAlive(): void {
    this.#stopKeepAlive();
    this.#keepAliveTimer = setInterval(() => {
      void this.#action(MONITOR_AIID.CAMERA_OPERATE, MONITOR_PIID.KEEP_ALIVE, keepAliveParams('opened')).catch(
        (err: unknown) => this.#onKeepAliveError?.(err),
      );
    }, this.#keepAliveIntervalMs);
    // Don't hold the event loop open on the keep-alive timer alone.
    this.#keepAliveTimer.unref?.();
  }

  #stopKeepAlive(): void {
    if (this.#keepAliveTimer) {
      clearInterval(this.#keepAliveTimer);
      this.#keepAliveTimer = null;
    }
  }

  /** Start the two-way intercom session (control plane only; see module docs on mic uplink). */
  async startIntercom(opts?: { needRecordSound?: boolean; videoCall?: boolean }): Promise<unknown> {
    return this.#action(MONITOR_AIID.VOICE_OPERATE, MONITOR_PIID.MONITOR_AUDIO_STATUS, intercomStartParams(opts));
  }

  /** Stop the two-way intercom session. */
  async stopIntercom(): Promise<unknown> {
    return this.#action(MONITOR_AIID.VOICE_OPERATE, MONITOR_PIID.MONITOR_AUDIO_STATUS, intercomStopParams());
  }

  /** Set the fill-light brightness (40–100 = manual %, below 40 / 101 = auto). */
  async setFillLight(value: number): Promise<unknown> {
    return this.#action(MONITOR_AIID.PROPERTY_OPERATE, MONITOR_PIID.FILL_LIGHT_SET, fillLightParams(value));
  }

  /** Stop the keep-alive loop and release the monitor on the device. Idempotent. */
  async close(): Promise<void> {
    this.#stopKeepAlive();
    if (!this.#opened) {
      this.#session = null;
      return;
    }
    this.#opened = false;
    try {
      await this.#action(MONITOR_AIID.CAMERA_OPERATE, MONITOR_PIID.MONITOR_STATUS, stopMonitorParams());
    } finally {
      this.#session = null;
    }
  }
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
