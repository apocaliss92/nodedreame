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
  TencentIdentityResponseSchema,
  TencentP2PInfoResponseSchema,
  VideoAccessTokenResponseSchema,
} from './schemas.js';
import { toVideoProfile } from './profile.js';
import type {
  DeviceVideoProfile,
  TencentDeviceIdentity,
  TencentP2PDescriptor,
  VideoAccessToken,
} from './types.js';

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
 * The device's TENCENT IoT triple.
 *
 * Only meaningful while the device sits on the `tx` vendor: the cloud answers
 * `设备三元组不存在` ("the triple does not exist") otherwise, which this
 * surfaces as a thrown {@link DreameError} like any other refusal — a device on
 * `ali` has no Tencent identity, and that is a statement about the device, not
 * a failure of the call.
 */
export async function getTencentIdentity(
  input: VideoRequestInput & { did: string; videoToken?: string },
): Promise<TencentDeviceIdentity> {
  const ctx = resolveCtx(input);
  const videoToken = input.videoToken ?? (await getVideoAccessToken({ ...input, ctx })).token;
  const raw = await httpPostJsonBody<BaseResponse>({
    ctx,
    path: `${P_THIRD_VIDEO}/tx/mgr/dev/getIdentity`,
    body: { accesstoken: videoToken, os: DEFAULT_OS, did: input.did },
    context: 'tencent identity',
    ...passthrough(input),
  });
  const d = TencentIdentityResponseSchema.parse(raw).data.data;
  return {
    productId: d.productId,
    deviceName: d.deviceName,
    deviceId: d.deviceId ?? null,
    secretId: d.secretId ?? null,
    secretKey: d.secretKey ?? null,
  };
}

/**
 * The xp2p session descriptor for a device on the `tx` vendor.
 *
 * ## This may WAKE THE CAMERA
 *
 * It is the Tencent equivalent of asking for a stream, so it is never called
 * as part of a status read.
 *
 * The result is opaque (see {@link TencentP2PDescriptor}) and is useless
 * without an xp2p implementation: measured on an X50 on 2026-09-16, the
 * sibling `tx/dev/getRtcInfo` — the TRTC path, which WOULD be portable — answers
 * 404 for this model. So the only media plane Tencent offers this device is the
 * proprietary UDP P2P one.
 */
export async function getTencentP2PInfo(
  input: VideoRequestInput & { did: string; videoToken?: string },
): Promise<TencentP2PDescriptor> {
  const ctx = resolveCtx(input);
  const videoToken = input.videoToken ?? (await getVideoAccessToken({ ...input, ctx })).token;
  const raw = await httpPostJsonBody<BaseResponse>({
    ctx,
    path: `${P_THIRD_VIDEO}/tx/dev/getP2PInfo`,
    body: { accesstoken: videoToken, os: DEFAULT_OS, did: input.did },
    context: 'tencent p2p info',
    ...passthrough(input),
  });
  return { p2pInfo: TencentP2PInfoResponseSchema.parse(raw).data.data.p2pInfo };
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
