/**
 * Camera media pipeline: the private-mode LinkVisual RTMP client and the
 * end-to-end {@link DreameCameraStream} that turns a cold camera into a live
 * feed of demuxed H.264 + AAC frames. Reusable by any consumer (scrypted RFC4571
 * muxer, camstack, offline capture).
 */
export {
  DreameCameraStream,
  type DreameCameraStreamInput,
  type DreameCameraStreamEvents,
  type FrameSource,
  type FrameSourceFactory,
} from './camera-stream.js';
export {
  LvRtmpClient,
  parseRelayUrl,
  LV_STATUS,
  TALK_AUDIO_HEADER_G711A,
  type LvRtmpClientOptions,
  type VideoAccessUnitEvent,
  type AudioInfoEvent,
  type StatusEvent,
} from './lv-rtmp-client.js';
export { pcm16ToALaw, pcm16leToALaw } from './g711.js';
export {
  avccToAnnexB,
  aacToAdts,
  parseAvcConfig,
  parseAacConfig,
  aacSampleRate,
  type AvcConfig,
  type AacConfig,
} from './flv.js';
