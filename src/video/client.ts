import type { DreameRegion } from '../auth/config.js';
import type { DreameSession } from '../cloud/types.js';
import {
  httpPostJsonBody,
  RequestContext,
  type BaseResponse,
  type FetchImpl,
} from '../transport/http.js';
import {
  AuthCodeResponseSchema,
  DeviceInfoResponseSchema,
  FamilyIdResponseSchema,
  VideoAccessTokenResponseSchema,
} from './schemas.js';
import { toVideoProfile } from './profile.js';
import type { DeviceVideoProfile, VideoAccessToken } from './types.js';

/** Path prefixes for the two video control-plane services on the region host. */
const P_THIRD_VIDEO = '/dreame-third-video';
const P_SMARTHOME = '/dreame-smarthome';
const P_USER_IOT = '/dreame-user-iot';

/** `os` form value the app sends; the cloud accepts any of android/iOS/1/2. */
const DEFAULT_OS = 'android';

/** Shared inputs for every video control-plane call. Mirrors `listDevices`. */
export interface VideoRequestInput {
  session: DreameSession;
  region: DreameRegion;
  ctx?: RequestContext;
  country?: string;
  lang?: string;
  apiHost?: string;
  fetchImpl?: FetchImpl;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function resolveCtx(input: VideoRequestInput): RequestContext {
  return input.ctx ?? RequestContext.from({ ...input, host: input.apiHost });
}

function passthrough(input: VideoRequestInput): {
  accessToken: string;
  signal?: AbortSignal;
  timeoutMs?: number;
} {
  return {
    accessToken: input.session.accessToken,
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
  };
}

/**
 * Mint the short-lived third-video access token. Required as a body field by the
 * device-scoped video calls (getIdentity, getP2PInfo, …).
 */
export async function getVideoAccessToken(input: VideoRequestInput): Promise<VideoAccessToken> {
  const ctx = resolveCtx(input);
  const raw = await httpPostJsonBody<BaseResponse>({
    ctx,
    path: `${P_THIRD_VIDEO}/tx/user/accesstoken`,
    body: { os: DEFAULT_OS },
    context: 'video accesstoken',
    ...passthrough(input),
  });
  const parsed = VideoAccessTokenResponseSchema.parse(raw);
  const d = parsed.data.data;
  return {
    token: d.token,
    userId: d.userId !== undefined ? String(d.userId) : null,
    // Cloud reports expiry in epoch-seconds; expose epoch-ms like DreameSession.
    expiresAt: d.expireAt !== undefined ? d.expireAt * 1000 : 0,
  };
}

/**
 * Fetch the Aliyun authCode blob (`getAuthCodeV3`). This opaque hex string is the
 * material exchanged with Aliyun IoT to obtain a LinkVisual identity — the first
 * step of the Aliyun media path.
 */
export async function getAliyunAuthCode(input: VideoRequestInput): Promise<string> {
  const ctx = resolveCtx(input);
  const raw = await httpPostJsonBody<BaseResponse>({
    ctx,
    path: `${P_SMARTHOME}/aliIot/getAuthCodeV3`,
    body: { os: DEFAULT_OS },
    context: 'aliyun authCode',
    ...passthrough(input),
  });
  return AuthCodeResponseSchema.parse(raw).data;
}

/**
 * Fetch the account's video `familyId` (used to scope some vendor calls). This
 * endpoint requires the third-video access token in the body — pass one via
 * `videoToken`, otherwise a fresh one is minted with {@link getVideoAccessToken}.
 */
export async function getVideoFamilyId(
  input: VideoRequestInput & { videoToken?: string },
): Promise<string> {
  const ctx = resolveCtx(input);
  const videoToken = input.videoToken ?? (await getVideoAccessToken({ ...input, ctx })).token;
  const raw = await httpPostJsonBody<BaseResponse>({
    ctx,
    path: `${P_THIRD_VIDEO}/tx/mgr/family/getFamilyId`,
    body: { accesstoken: videoToken, os: DEFAULT_OS },
    context: 'video familyId',
    ...passthrough(input),
  });
  return FamilyIdResponseSchema.parse(raw).data.data.familyId;
}

/**
 * Resolve a device's video profile (vendor, supported vendors, Aliyun iotId,
 * capability) from its cloud record. `did` is the Dreame device id.
 */
export async function getDeviceVideoProfile(
  input: VideoRequestInput & { did: string },
): Promise<DeviceVideoProfile> {
  const ctx = resolveCtx(input);
  const raw = await httpPostJsonBody<BaseResponse>({
    ctx,
    path: `${P_USER_IOT}/iotuserbind/device/info`,
    body: { did: input.did },
    context: 'device video info',
    ...passthrough(input),
  });
  return toVideoProfile(DeviceInfoResponseSchema.parse(raw).data);
}
