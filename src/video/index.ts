/**
 * Video control-plane for Dreame camera devices (X40/X50 class). Reuses the
 * authenticated cloud session to negotiate the per-vendor video access token,
 * the Aliyun authCode, and a device's video profile (vendor + LinkVisual iotId).
 * The per-vendor media transport is layered on top of these primitives.
 */
export {
  getVideoAccessToken,
  getAliyunAuthCode,
  getVideoFamilyId,
  getDeviceVideoProfile,
  type VideoRequestInput,
} from './client.js';
export { toVideoProfile } from './profile.js';
export type { VideoVendor, VideoAccessToken, DeviceVideoProfile } from './types.js';

// --- Aliyun LinkVisual media plane -----------------------------------------
export { signApiGatewayRequest } from './aliyun/signing.js';
export { streamQuery, type StreamInfo, type StreamQueryInput } from './aliyun/vision.js';
export { loginByOauth, createIotSession, type OaSession, type IotSession } from './aliyun/identity.js';
export { ALIYUN_REGION_ID } from './aliyun/constants.js';
export { DreameVideoSession, type DreameVideoSessionInput } from './aliyun/session.js';
