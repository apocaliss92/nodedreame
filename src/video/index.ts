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
  getTencentIdentity,
  getTencentP2PInfo,
  type VideoRequestInput,
} from './client.js';
export { explainNoCameraChannel } from './camera-availability.js';
export { toVideoProfile } from './profile.js';
export type { VideoVendor, VideoAccessToken, DeviceVideoProfile } from './types.js';

// --- Aliyun LinkVisual media plane -----------------------------------------
export { signApiGatewayRequest } from './aliyun/signing.js';
export { streamQuery, type StreamInfo, type StreamQueryInput } from './aliyun/vision.js';
export { loginByOauth, createIotSession, type OaSession, type IotSession } from './aliyun/identity.js';
export { ALIYUN_REGION_ID } from './aliyun/constants.js';
export { DreameVideoSession, type DreameVideoSessionInput } from './aliyun/session.js';

// --- Camera monitor control-plane (MIoT SIID 10001) + autonomous cold-start --
export {
  DreameCameraController,
  type DreameCameraControllerInput,
  type CameraStreamHandle,
  type MonitorActionCaller,
  type RelayMinter,
  MONITOR_SIID,
  MONITOR_AIID,
  MONITOR_PIID,
  MONITOR_VENDOR_TOKEN,
  makeMonitorSession,
  hashAccessCode,
  parsePersonFollow,
  parseObstacleData,
  remoteDriveValue,
  DRIVE_DIRECTIONS,
  VACUUM_SIID,
  VACUUM_MOVE,
  PET_SOUNDS,
  VACUUM_ACTIONS,
  type PetSound,
  type VacuumActionKey,
  type DetectionBox,
  type PersonFollowDetection,
  type ObstacleDetection,
  type DriveDirection,
} from './monitor/index.js';

// --- Camera media pipeline (RTMP relay -> H.264/AAC frames) -----------------
export {
  DreameCameraStream,
  type DreameCameraStreamInput,
  type DreameCameraStreamEvents,
  type FrameSource,
  type FrameSourceFactory,
  LvRtmpClient,
  parseRelayUrl,
  LV_STATUS,
  TALK_AUDIO_HEADER_G711A,
  pcm16ToALaw,
  pcm16leToALaw,
  type LvRtmpClientOptions,
  type VideoAccessUnitEvent,
  type AudioInfoEvent,
  type StatusEvent,
  avccToAnnexB,
  aacToAdts,
  parseAvcConfig,
  parseAacConfig,
  aacSampleRate,
  type AvcConfig,
  type AacConfig,
} from './media/index.js';
