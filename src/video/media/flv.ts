/**
 * FLV tag payload helpers: AVC (H.264) AVCC -> Annex-B, AAC raw -> ADTS, and an FLV file writer
 * for offline verification (`ffprobe out.flv`).
 */

export interface VideoTag {
  frameType: number; // 1 = keyframe, 2 = inter
  codecId: number; // 7 = AVC
  avcPacketType: number; // 0 = sequence header, 1 = NALU, 2 = end of sequence
  compositionTime: number;
  data: Buffer;
}

export interface AudioTag {
  soundFormat: number; // 10 = AAC, 7 = G.711 A-law, 8 = G.711 mu-law
  sampleRateIndex: number; // FLV: 0=5.5k 1=11k 2=22k 3=44k (informational for AAC)
  channels: number; // 1 or 2
  aacPacketType: number | null; // 0 = AudioSpecificConfig, 1 = raw frame (AAC only)
  data: Buffer;
}

export interface AvcConfig {
  sps: Buffer[];
  pps: Buffer[];
  nalLengthSize: number;
}

export interface AacConfig {
  objectType: number;
  samplingFrequencyIndex: number;
  channelConfiguration: number;
}

const ANNEXB_START = Buffer.from([0, 0, 0, 1]);

export function parseVideoTag(body: Buffer): VideoTag | null {
  if (body.length < 5) return null;
  const b0 = body[0]!;
  return {
    frameType: b0 >> 4,
    codecId: b0 & 0x0f,
    avcPacketType: body[1]!,
    compositionTime: body.readIntBE(2, 3),
    data: body.subarray(5),
  };
}

export function parseAudioTag(body: Buffer): AudioTag | null {
  if (body.length < 1) return null;
  const b0 = body[0]!;
  const soundFormat = b0 >> 4;
  const isAac = soundFormat === 10;
  if (isAac && body.length < 2) return null;
  return {
    soundFormat,
    sampleRateIndex: (b0 >> 2) & 3,
    channels: (b0 & 1) + 1,
    aacPacketType: isAac ? body[1]! : null,
    data: body.subarray(isAac ? 2 : 1),
  };
}

/** Parse an AVCDecoderConfigurationRecord (FLV AVC sequence header payload). */
export function parseAvcConfig(rec: Buffer): AvcConfig {
  const nalLengthSize = (rec[4]! & 3) + 1;
  let p = 5;
  const sps: Buffer[] = [];
  const pps: Buffer[] = [];
  const numSps = rec[p++]! & 0x1f;
  for (let i = 0; i < numSps; i++) { const n = rec.readUInt16BE(p); sps.push(Buffer.from(rec.subarray(p + 2, p + 2 + n))); p += 2 + n; }
  const numPps = rec[p++]!;
  for (let i = 0; i < numPps; i++) { const n = rec.readUInt16BE(p); pps.push(Buffer.from(rec.subarray(p + 2, p + 2 + n))); p += 2 + n; }
  return { sps, pps, nalLengthSize };
}

/** Length-prefixed NALUs -> Annex-B. Prepends SPS/PPS when `prependParams` is set (for keyframes). */
export function avccToAnnexB(data: Buffer, cfg: AvcConfig, prependParams: boolean): Buffer {
  const parts: Buffer[] = [];
  if (prependParams) for (const nal of [...cfg.sps, ...cfg.pps]) parts.push(ANNEXB_START, nal);
  let p = 0;
  while (p + cfg.nalLengthSize <= data.length) {
    const len = data.readUIntBE(p, cfg.nalLengthSize);
    p += cfg.nalLengthSize;
    if (len === 0 || p + len > data.length) break;
    parts.push(ANNEXB_START, data.subarray(p, p + len));
    p += len;
  }
  return Buffer.concat(parts);
}

export function parseAacConfig(asc: Buffer): AacConfig {
  const a0 = asc[0]!;
  const a1 = asc[1]!;
  return {
    objectType: a0 >> 3,
    samplingFrequencyIndex: ((a0 & 7) << 1) | (a1 >> 7),
    channelConfiguration: (a1 >> 3) & 0x0f,
  };
}

const AAC_SAMPLE_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

export function aacSampleRate(cfg: AacConfig): number {
  return AAC_SAMPLE_RATES[cfg.samplingFrequencyIndex] ?? 0;
}

/** Wrap one raw AAC frame in a 7-byte ADTS header. */
export function aacToAdts(raw: Buffer, cfg: AacConfig): Buffer {
  const frameLen = raw.length + 7;
  const h = Buffer.alloc(7);
  h[0] = 0xff;
  h[1] = 0xf1; // MPEG-4, layer 0, no CRC
  h[2] = ((cfg.objectType - 1) << 6) | (cfg.samplingFrequencyIndex << 2) | (cfg.channelConfiguration >> 2);
  h[3] = ((cfg.channelConfiguration & 3) << 6) | ((frameLen >> 11) & 3);
  h[4] = (frameLen >> 3) & 0xff;
  h[5] = ((frameLen & 7) << 5) | 0x1f;
  h[6] = 0xfc;
  return Buffer.concat([h, raw]);
}

/** Minimal FLV file writer (header + tags) for offline inspection. */
export class FlvWriter {
  private readonly chunks: Buffer[] = [];

  constructor() {
    const hdr = Buffer.from([0x46, 0x4c, 0x56, 0x01, 0x05, 0, 0, 0, 9, 0, 0, 0, 0]);
    this.chunks.push(hdr);
  }

  tag(type: number, timestamp: number, body: Buffer): void {
    const h = Buffer.alloc(11);
    h[0] = type;
    h.writeUIntBE(body.length, 1, 3);
    h.writeUIntBE(timestamp & 0xffffff, 4, 3);
    h[7] = (timestamp >> 24) & 0xff;
    const prev = Buffer.alloc(4);
    prev.writeUInt32BE(11 + body.length, 0);
    this.chunks.push(h, body, prev);
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}
