import { z } from 'zod';
import { defaultFetch, type FetchImpl } from '../../transport/fetch.js';
import { DreameApiError, DreameDeviceOfflineError } from '../../transport/errors.js';

/** LinkVisual code meaning the device's video agent isn't connected yet (waking). */
export const VISION_DEVICE_OFFLINE = 9201;
import {
  ALIYUN_APP_KEY,
  ALIYUN_APP_SECRET,
  apiIotHost,
  VISION_STREAM_QUERY,
} from './constants.js';
import { signApiGatewayRequest } from './signing.js';

/** LinkVisual live-stream descriptor returned by /vision/customer/stream/query. */
export interface StreamInfo {
  /** Connection strategies the cloud offers, e.g. ["Direct","Relay","NAT"]. */
  typeList: string[];
  /** RTMP relay URL. Plain (playable directly) when requested with relayEncrypted:false. */
  relayUrl: string | null;
  /** AES key/iv for the relay payload — present (non-empty) only when relayEncrypted:true. */
  relayDecryptKey: { iv: string; key: string } | null;
  /** P2P (Direct/NAT) parameters: STUN/TURN + the WebSocket signaling URL. */
  p2pInfo: {
    stunUrl?: string;
    alterStunUrl?: string;
    signalUrl?: string;
    portDetectStunUrlList?: string[];
  } | null;
  supportVisionPtz?: boolean;
}

const StreamQueryResponseSchema = z
  .object({
    code: z.number().optional(),
    message: z.string().nullish(),
    data: z
      .object({
        typeList: z.array(z.string()).optional(),
        relayUrl: z.string().optional(),
        relayDecryptKey: z
          .object({ iv: z.string().optional(), key: z.string().optional() })
          .passthrough()
          .optional(),
        p2pInfo: z
          .object({
            stunUrl: z.string().optional(),
            alterStunUrl: z.string().optional(),
            signalUrl: z.string().optional(),
            portDetectStunUrlList: z.array(z.string()).optional(),
          })
          .passthrough()
          .optional(),
        supportVisionPtz: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export interface StreamQueryInput {
  /** Aliyun IoT region id, e.g. `eu-central-1`. */
  regionId: string;
  /** Short-lived IoT identity token (from createSessionByAuthCode). */
  iotToken: string;
  /** LinkVisual device id. */
  iotId: string;
  /**
   * When false (default) the relay RTMP carries a PLAIN (unencrypted) FLV, so it
   * can be handed straight to ffmpeg. When true the payload is AES-encrypted and
   * `relayDecryptKey` is returned.
   */
  relayEncrypted?: boolean;
  /** 0 = HD main stream (default). */
  streamType?: number;
  appKey?: string;
  appSecret?: string;
  fetchImpl?: FetchImpl;
  signal?: AbortSignal;
}

/**
 * Query the LinkVisual live stream for a device. Returns the relay RTMP URL and
 * P2P parameters. Note: each returned relay token is single-use — request a
 * fresh one per consumer.
 */
export async function streamQuery(input: StreamQueryInput): Promise<StreamInfo> {
  const appKey = input.appKey ?? ALIYUN_APP_KEY;
  const appSecret = input.appSecret ?? ALIYUN_APP_SECRET;
  const host = apiIotHost(input.regionId);
  const payload = {
    id: crypto.randomUUID().toUpperCase(),
    params: {
      streamType: input.streamType ?? 0,
      needDomainName: true,
      relayEncryptType: 0,
      clientType: 'iOS',
      iotId: input.iotId,
      enablePortPredict: true,
      enableWebSocket: true,
      forceIFrame: true,
      cacheDuration: 3000,
      relayEncrypted: input.relayEncrypted ?? false,
    },
    request: { language: 'en-US', appKey, iotToken: input.iotToken, apiVer: '2.2.0' },
    version: '1.0.0',
  };
  const signed = signApiGatewayRequest({
    method: 'POST',
    host,
    path: VISION_STREAM_QUERY,
    appKey,
    appSecret,
    json: payload,
    extraCaHeaders: { 'X-Ca-Stage': 'RELEASE' },
  });

  const fetchImpl = input.fetchImpl ?? defaultFetch;
  const res = await fetchImpl(`https://${host}${VISION_STREAM_QUERY}`, {
    method: 'POST',
    headers: signed.headers,
    body: signed.body,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new DreameApiError(`stream/query returned non-JSON (status ${res.status})`, res.status);
  }
  const parsed = StreamQueryResponseSchema.parse(json);
  if (parsed.code === VISION_DEVICE_OFFLINE) {
    // The device's video agent is not connected yet — querying wakes it via the
    // LinkVisual cloud, so this is retryable (see DreameVideoSession.getStreamInfo).
    throw new DreameDeviceOfflineError(
      `stream/query: device video agent offline (code ${VISION_DEVICE_OFFLINE}) — retry to wake`,
      res.status,
      parsed,
    );
  }
  if (parsed.code !== 200 && parsed.code !== 0) {
    throw new DreameApiError(
      `stream/query rejected: code=${parsed.code} msg=${parsed.message ?? '?'}`,
      res.status,
      parsed,
    );
  }
  const d = parsed.data ?? {};
  const dk = d.relayDecryptKey;
  const hasKey = dk && dk.iv && dk.key;
  const p = d.p2pInfo;
  const p2pInfo: StreamInfo['p2pInfo'] = p
    ? {
        ...(p.stunUrl !== undefined ? { stunUrl: p.stunUrl } : {}),
        ...(p.alterStunUrl !== undefined ? { alterStunUrl: p.alterStunUrl } : {}),
        ...(p.signalUrl !== undefined ? { signalUrl: p.signalUrl } : {}),
        ...(p.portDetectStunUrlList !== undefined
          ? { portDetectStunUrlList: p.portDetectStunUrlList }
          : {}),
      }
    : null;
  return {
    typeList: d.typeList ?? [],
    relayUrl: d.relayUrl ?? null,
    relayDecryptKey: hasKey ? { iv: dk.iv as string, key: dk.key as string } : null,
    p2pInfo,
    ...(d.supportVisionPtz !== undefined ? { supportVisionPtz: d.supportVisionPtz } : {}),
  };
}
