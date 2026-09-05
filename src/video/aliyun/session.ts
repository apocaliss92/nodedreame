import type { DreameRegion } from '../../auth/config.js';
import type { DreameSession } from '../../cloud/types.js';
import type { FetchImpl } from '../../transport/http.js';
import { getAliyunAuthCode } from '../client.js';
import { ALIYUN_REGION_ID } from './constants.js';
import { DreameDeviceOfflineError } from '../../transport/errors.js';
import { createIotSession, loginByOauth, type IotSession } from './identity.js';
import { streamQuery, type StreamInfo } from './vision.js';

/** Default budget to wake a cold device via retried stream/query. */
const DEFAULT_WAKE_TIMEOUT_MS = 30_000;
const DEFAULT_WAKE_POLL_MS = 2_000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Refresh the IoT session this many ms before it actually expires. */
const REFRESH_LEEWAY_MS = 60_000;

export interface DreameVideoSessionInput {
  /** An authenticated Dreame account session (from `Nodreame`). */
  session: DreameSession;
  region: DreameRegion;
  fetchImpl?: FetchImpl;
}

/**
 * High-level video session for a Dreame account. Establishes and caches the
 * Aliyun IoT identity (iotToken), and mints fresh LinkVisual RTMP stream URLs
 * on demand. Each returned relay URL is single-use — call {@link getStreamInfo}
 * (or {@link getRtmpUrl}) once per consumer.
 *
 * The plain (unencrypted) relay URL is a standard RTMP stream: hand it straight
 * to ffmpeg / scrypted / camstack. No local muxing or RTSP server required here.
 */
export class DreameVideoSession {
  readonly #session: DreameSession;
  readonly #region: DreameRegion;
  readonly #regionId: string;
  readonly #fetchImpl: FetchImpl | undefined;
  #iot: IotSession | null = null;
  #inFlight: Promise<IotSession> | null = null;

  constructor(input: DreameVideoSessionInput) {
    this.#session = input.session;
    this.#region = input.region;
    this.#regionId = ALIYUN_REGION_ID[input.region];
    this.#fetchImpl = input.fetchImpl;
  }

  /** The resolved Aliyun IoT region id (e.g. `eu-central-1`). */
  get regionId(): string {
    return this.#regionId;
  }

  /** Mint (or reuse) a valid Aliyun IoT session, refreshing before expiry. */
  async ensureIotSession(): Promise<IotSession> {
    const cur = this.#iot;
    if (cur && Date.now() < cur.expiresAt - REFRESH_LEEWAY_MS) {
      return cur;
    }
    if (this.#inFlight) {
      return this.#inFlight;
    }
    this.#inFlight = this.#mint();
    try {
      this.#iot = await this.#inFlight;
      return this.#iot;
    } finally {
      this.#inFlight = null;
    }
  }

  async #mint(): Promise<IotSession> {
    const base = {
      session: this.#session,
      region: this.#region,
      ...(this.#fetchImpl ? { fetchImpl: this.#fetchImpl } : {}),
    };
    const authCode = await getAliyunAuthCode(base);
    const oa = await loginByOauth({
      authCode,
      regionId: this.#regionId,
      ...(this.#fetchImpl ? { fetchImpl: this.#fetchImpl } : {}),
    });
    return createIotSession({
      sid: oa.sid,
      regionId: this.#regionId,
      ...(this.#fetchImpl ? { fetchImpl: this.#fetchImpl } : {}),
    });
  }

  /**
   * Mint a fresh LinkVisual stream descriptor for a device. `encrypted:false`
   * (default) yields a plain RTMP relay URL directly playable by ffmpeg.
   *
   * A camera that has been idle reports "device offline" until the query wakes
   * its video agent via the LinkVisual cloud. This transparently retries on that
   * (up to `wakeTimeoutMs`, default 30s) so a single call returns a live stream;
   * pass `wakeTimeoutMs: 0` to fail fast instead.
   */
  async getStreamInfo(
    iotId: string,
    opts?: { encrypted?: boolean; wakeTimeoutMs?: number; pollMs?: number },
  ): Promise<StreamInfo> {
    const deadline = Date.now() + (opts?.wakeTimeoutMs ?? DEFAULT_WAKE_TIMEOUT_MS);
    const pollMs = opts?.pollMs ?? DEFAULT_WAKE_POLL_MS;
    for (;;) {
      const iot = await this.ensureIotSession();
      try {
        return await streamQuery({
          regionId: this.#regionId,
          iotToken: iot.iotToken,
          iotId,
          relayEncrypted: opts?.encrypted ?? false,
          ...(this.#fetchImpl ? { fetchImpl: this.#fetchImpl } : {}),
        });
      } catch (err) {
        if (err instanceof DreameDeviceOfflineError && Date.now() + pollMs < deadline) {
          await sleep(pollMs);
          continue;
        }
        throw err;
      }
    }
  }

  /**
   * Convenience: mint a fresh plain RTMP relay URL for a device, or `null` when
   * the device is not currently streaming (no relay available).
   */
  async getRtmpUrl(iotId: string): Promise<string | null> {
    const info = await this.getStreamInfo(iotId, { encrypted: false });
    return info.relayUrl;
  }
}
