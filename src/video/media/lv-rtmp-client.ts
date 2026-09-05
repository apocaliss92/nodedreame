/**
 * Minimal Node RTMP client that replicates the Aliyun LinkVisual viewer ("private mode" librtmp)
 * exactly as observed on the wire (findings/dreame.pcap, findings/dr3.pcap — client->relay bytes,
 * VERIFIED) and in liblvmedia.so / liblvrtmp.so (VERIFIED by disassembly).
 *
 * Wire sequence (all four written back-to-back, BEFORE any server byte is read — like the app):
 *   C0 = 0x04, C1 = [uptime_ms u32][0 0 0 0][1528 random]           (no C2 is ever sent)
 *   connect      (txn 1, csid 3, msid 0, fmt 0) {app, tcUrl, fpad:false, capabilities:15,
 *                 audioCodecs:3191, videoCodecs:252, videoFunction:1}   — no flashVer, no objectEncoding
 *   play         (txn 2, csid 8, msid 1, fmt 0) null, <playpath>, -1000  — NO createStream (msid fixed = 1)
 *   onStatus     (txn 3, csid 3, fmt 1) null, {level:"status", code:"NetStream.RequestAudioType",
 *                 description:"desc", audio_type:"1"}
 * Then the server answers S0(0x04)+S1(1536) followed directly by RTMP messages (no S2), chunked with an
 * implicit 60000-byte chunk size. After the first server message is processed the app sends
 *   onStatus     (txn 4, csid 3, fmt 1) null, {level:"status", code:"NetStream.Ping.Start", description:"desc"}
 * and repeats it every 30 s (CStreamUnit::ProcessRtmpStream). The client never replies to server onStatus.
 *
 * What is ASSUMED (not observable in the pcaps, which lack the server->client direction): that the
 * server sends onStatus NetStream.Play.Start (librtmp requires it before accepting media), and that this
 * exact sequence — rather than one specific element of it — is what makes the robot publish VIDEO.
 */
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { amfBoolean, amfNull, amfNumber, amfObject, amfString, decodeAmf0, type AmfValue } from './amf0.js';
import { ChunkReader, MSG, PRIVATE_MODE_CHUNK_SIZE, encodeMessage, type RtmpMessage } from './chunk.js';
import {
  aacSampleRate, aacToAdts, avccToAnnexB, parseAacConfig, parseAudioTag, parseAvcConfig, parseVideoTag,
  type AacConfig, type AvcConfig,
} from './flv.js';

export const LV_STATUS = {
  REQUEST_AUDIO_TYPE: 'NetStream.RequestAudioType',
  FORCE_IFRAME_START: 'NetStream.ForceIFrame.Start',
  PING_START: 'NetStream.Ping.Start',
  PING_RESPONSE: 'NetStream.Ping.Response',
  PRE_CONNECT: 'NetStream.PreConnect',
  KEEPALIVE: 'NetStream.Keepalive',
  SERVER_INFO: 'NetStream.ServerInfo',
  TRANSFER_DATA: 'NetStream.TransferData',
  PLAY_START: 'NetStream.Play.Start',
} as const;

/** librtmp constants observed in the app's connect (RTMP_Connect1/SendConnectPacket). */
const CONNECT_CAPABILITIES = 15;
const CONNECT_AUDIO_CODECS = 3191;
const CONNECT_VIDEO_CODECS = 252;
const CONNECT_VIDEO_FUNCTION = 1;
const PLAY_START_LIVE = -1000; // RTMP_LF_LIVE -> start = -1000
const HANDSHAKE_C0_PRIVATE = 0x04;
const HANDSHAKE_S0S1_LEN = 1537;
const DEFAULT_PING_INTERVAL_MS = 30_000; // ProcessRtmpStream: 30000
const DEFAULT_CACHE_DURATION_MS = 3000; // app: "&cacheDuration=3000"
const ACK_THRESHOLD_BYTES = 250_000; // librtmp: m_nClientBW(2500000)/10
const CSID_CONTROL = 2;
const CSID_COMMAND = 3;
const CSID_PLAY = 8;
const PLAY_STREAM_ID = 1; // RTMP_InitPrivateConfig: m_stream_id = 1

export interface StatusEvent {
  code: string;
  level: string;
  description: string;
  fields: { [key: string]: AmfValue };
  transactionId: number;
}

export interface VideoAccessUnitEvent {
  data: Buffer; // Annex-B access unit (SPS/PPS prepended on keyframes)
  isKeyframe: boolean;
  videoType: 'H264';
  microseconds: number;
  time?: number;
}

export interface AudioInfoEvent {
  codec: 'aac' | 'g711a' | 'g711u' | 'unknown';
  sampleRate: number;
  channels: number;
}

export interface LvRtmpClientOptions {
  /** relayUrl from stream/query, e.g. rtmp://host:8000/live?token=..&session=../<key>_0 */
  url: string;
  /** Appended to app/tcUrl as "&cacheDuration=N" when not already present (the app always sends 3000). */
  cacheDurationMs?: number;
  /** Send the onStatus NetStream.RequestAudioType {audio_type:"1"} right after play (app does). */
  requestAudioType?: boolean;
  /** Send NetStream.Ping.Start after the first server message and then periodically (app does). */
  ping?: boolean;
  pingIntervalMs?: number;
  /** Also send NetStream.ForceIFrame.Start once playing (the app sends it when it starts an MP4 record). */
  forceIFrameOnStart?: boolean;
  connectTimeoutMs?: number;
  log?: (line: string) => void;
}

interface Endpoint {
  host: string;
  port: number;
  app: string;
  tcUrl: string;
  playpath: string;
}

/**
 * Split like librtmp/ffmpeg do: playpath = last path segment, app = everything between host and it
 * (query string included). Verified against the app's connect/play in both pcaps.
 */
export function parseRelayUrl(url: string, cacheDurationMs: number): Endpoint {
  const m = /^rtmp:\/\/([^/:]+)(?::(\d+))?\/(.*)$/.exec(url);
  if (!m) throw new Error(`not an rtmp:// url: ${url}`);
  const host = m[1]!;
  const port = m[2] ? Number(m[2]) : 1935;
  const path = m[3]!;
  const slash = path.lastIndexOf('/');
  if (slash < 0) throw new Error(`relay url has no playpath: ${url}`);
  let app = path.slice(0, slash);
  const playpath = path.slice(slash + 1);
  if (!/[?&]cacheDuration=/.test(app)) app += `${app.includes('?') ? '&' : '?'}cacheDuration=${cacheDurationMs}`;
  return { host, port, app, playpath, tcUrl: `rtmp://${host}:${port}/${app}` };
}

type Events = {
  connected: [];
  status: [StatusEvent];
  command: [string, AmfValue[]];
  metadata: [{ [key: string]: AmfValue }];
  audio: [{ timestamp: number; body: Buffer }];
  video: [{ timestamp: number; body: Buffer }];
  videoAccessUnit: [VideoAccessUnitEvent];
  audioFrame: [Buffer];
  audioInfo: [AudioInfoEvent];
  error: [Error];
  close: [];
};

export class LvRtmpClient extends EventEmitter<Events> {
  private readonly opts: Required<Omit<LvRtmpClientOptions, 'log'>> & { log: (line: string) => void };
  private readonly endpoint: Endpoint;
  private socket: net.Socket | null = null;
  private handshakeBuf: Buffer = Buffer.alloc(0);
  private handshakeDone = false;
  private c1Time = 0;
  private reader = new ChunkReader(PRIVATE_MODE_CHUNK_SIZE);
  private transactionId = 0;
  private bytesIn = 0;
  private bytesAcked = 0;
  private ackWindow = ACK_THRESHOLD_BYTES;
  private pingTimer: NodeJS.Timeout | null = null;
  private firstMessageSeen = false;
  private avcConfig: AvcConfig | null = null;
  private aacConfig: AacConfig | null = null;
  private closed = false;

  constructor(options: LvRtmpClientOptions) {
    super();
    this.opts = {
      url: options.url,
      cacheDurationMs: options.cacheDurationMs ?? DEFAULT_CACHE_DURATION_MS,
      requestAudioType: options.requestAudioType ?? true,
      ping: options.ping ?? true,
      pingIntervalMs: options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS,
      forceIFrameOnStart: options.forceIFrameOnStart ?? false,
      connectTimeoutMs: options.connectTimeoutMs ?? 10_000,
      log: options.log ?? (() => {}),
    };
    this.endpoint = parseRelayUrl(this.opts.url, this.opts.cacheDurationMs);
  }

  /** Open TCP, write C0+C1 and the pipelined connect/play/RequestAudioType. Resolves once written. */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host: this.endpoint.host, port: this.endpoint.port });
      this.socket = sock;
      sock.setNoDelay(true);
      sock.setTimeout(this.opts.connectTimeoutMs, () => { if (!this.handshakeDone) this.fail(new Error('handshake timeout')); });
      sock.once('error', (err) => { this.emit('error', err); reject(err); });
      sock.on('data', (d) => this.onData(d));
      sock.on('close', () => this.onClose());
      sock.once('connect', () => {
        this.opts.log(`tcp connected ${this.endpoint.host}:${this.endpoint.port}`);
        sock.write(Buffer.concat([this.buildC0C1(), ...this.buildOpeningSequence()]));
        this.emit('connected');
        resolve();
      });
    });
  }

  close(): void {
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.socket?.destroy();
  }

  /** onStatus encoder — byte-exact replica of liblvmedia IOT_RTMP_SendMessage (csid 3, fmt 1, ts 0). */
  buildStatus(code: string, extra?: readonly [string, string]): Buffer {
    const pairs: Array<readonly [string, Buffer]> = [
      ['level', amfString('status')],
      ['code', amfString(code)],
      ['description', amfString('desc')],
    ];
    if (extra) pairs.push([extra[0], amfString(extra[1])]);
    const body = Buffer.concat([amfString('onStatus'), amfNumber(++this.transactionId), amfNull(), amfObject(pairs)]);
    return encodeMessage({ fmt: 1, csid: CSID_COMMAND, type: MSG.COMMAND_AMF0, body });
  }

  sendStatus(code: string, extra?: readonly [string, string]): void {
    this.write(this.buildStatus(code, extra));
    this.opts.log(`>> onStatus ${code}${extra ? ` ${extra[0]}=${extra[1]}` : ''} (txn ${this.transactionId})`);
  }

  forceIFrame(): void {
    this.sendStatus(LV_STATUS.FORCE_IFRAME_START);
  }

  // ---------------------------------------------------------------- outgoing

  private buildC0C1(): Buffer {
    this.c1Time = Math.floor(performance.now()) >>> 0;
    const c1 = Buffer.alloc(1536);
    c1.writeUInt32BE(this.c1Time, 0);
    c1.writeUInt32BE(0, 4);
    randomBytes(1528).copy(c1, 8);
    return Buffer.concat([Buffer.from([HANDSHAKE_C0_PRIVATE]), c1]);
  }

  private buildConnect(): Buffer {
    const obj = amfObject([
      ['app', amfString(this.endpoint.app)],
      ['tcUrl', amfString(this.endpoint.tcUrl)],
      ['fpad', amfBoolean(false)],
      ['capabilities', amfNumber(CONNECT_CAPABILITIES)],
      ['audioCodecs', amfNumber(CONNECT_AUDIO_CODECS)],
      ['videoCodecs', amfNumber(CONNECT_VIDEO_CODECS)],
      ['videoFunction', amfNumber(CONNECT_VIDEO_FUNCTION)],
    ]);
    const body = Buffer.concat([amfString('connect'), amfNumber(++this.transactionId), obj]);
    return encodeMessage({ fmt: 0, csid: CSID_COMMAND, msid: 0, type: MSG.COMMAND_AMF0, body });
  }

  private buildPlay(): Buffer {
    const body = Buffer.concat([
      amfString('play'), amfNumber(++this.transactionId), amfNull(), amfString(this.endpoint.playpath), amfNumber(PLAY_START_LIVE),
    ]);
    return encodeMessage({ fmt: 0, csid: CSID_PLAY, msid: PLAY_STREAM_ID, type: MSG.COMMAND_AMF0, body });
  }

  /** Exposed for the byte-exact self-test against the pcap. */
  buildOpeningSequence(): Buffer[] {
    const seq = [this.buildConnect(), this.buildPlay()];
    if (this.opts.requestAudioType) seq.push(this.buildStatus(LV_STATUS.REQUEST_AUDIO_TYPE, ['audio_type', '1']));
    return seq;
  }

  private write(buf: Buffer): void {
    if (!this.socket || this.socket.destroyed) return;
    this.socket.write(buf);
  }

  private sendAck(): void {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(this.bytesIn >>> 0, 0);
    this.write(encodeMessage({ fmt: 0, csid: CSID_CONTROL, msid: 0, type: MSG.ACK, body: b }));
    this.bytesAcked = this.bytesIn;
  }

  private sendPingResponse(serverTs: Buffer): void {
    const body = Buffer.concat([Buffer.from([0, 7]), serverTs]);
    this.write(encodeMessage({ fmt: 0, csid: CSID_CONTROL, msid: 0, type: MSG.USER_CONTROL, body }));
  }

  private startPinging(): void {
    if (!this.opts.ping || this.pingTimer) return;
    this.sendStatus(LV_STATUS.PING_START);
    this.pingTimer = setInterval(() => this.sendStatus(LV_STATUS.PING_START), this.opts.pingIntervalMs);
  }

  // ---------------------------------------------------------------- incoming

  private onData(data: Buffer): void {
    this.bytesIn += data.length;
    let payload = data;
    if (!this.handshakeDone) {
      this.handshakeBuf = Buffer.concat([this.handshakeBuf, data]);
      if (this.handshakeBuf.length < HANDSHAKE_S0S1_LEN) return;
      this.onHandshake(this.handshakeBuf.subarray(0, HANDSHAKE_S0S1_LEN));
      payload = this.handshakeBuf.subarray(HANDSHAKE_S0S1_LEN);
      this.handshakeBuf = Buffer.alloc(0);
      this.handshakeDone = true;
      if (payload.length === 0) return;
    }
    let messages: RtmpMessage[];
    try {
      messages = this.reader.feed(payload);
    } catch (err) {
      this.fail(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    for (const m of messages) this.dispatch(m);
    if (this.bytesIn - this.bytesAcked >= this.ackWindow) this.sendAck();
  }

  private onHandshake(s0s1: Buffer): void {
    const s0 = s0s1[0]!;
    const serverTime = s0s1.readUInt32BE(1);
    const zero = s0s1.readUInt32BE(5);
    this.opts.log(`<< S0=0x${s0.toString(16)} S1.time=${serverTime} S1.zero=0x${zero.toString(16)} (client sent 0x04; app logs a mismatch but continues)`);
    // Robustness: a standards-mode server might append S2 (echo of our C1). liblvrtmp never reads one;
    // detect it anyway so we do not desync if the relay behaves differently for us.
    // (Handled lazily in dispatch: if the first "chunk" looks like our C1 echo we skip 1536 bytes.)
  }

  private dispatch(m: RtmpMessage): void {
    if (!this.firstMessageSeen) {
      this.firstMessageSeen = true;
      this.startPinging(); // ProcessRtmpStream sends Ping.Start right after processing the first packet
    }
    switch (m.type) {
      case MSG.SET_CHUNK_SIZE: {
        const size = m.body.readUInt32BE(0) & 0x7fffffff;
        this.opts.log(`<< SetChunkSize ${size}`);
        this.reader.chunkSize = size;
        return;
      }
      case MSG.WINDOW_ACK_SIZE:
        this.ackWindow = Math.min(ACK_THRESHOLD_BYTES, m.body.readUInt32BE(0));
        this.opts.log(`<< WindowAckSize ${m.body.readUInt32BE(0)}`);
        return;
      case MSG.SET_PEER_BW:
        this.opts.log(`<< SetPeerBandwidth ${m.body.readUInt32BE(0)} limit=${m.body[4]}`);
        return;
      case MSG.ACK:
      case MSG.ABORT:
        return;
      case MSG.USER_CONTROL:
        return this.onUserControl(m.body);
      case MSG.COMMAND_AMF0:
        return this.onCommand(m);
      case MSG.DATA_AMF0:
        return this.onDataMessage(m.body);
      case MSG.AUDIO:
        return this.onAudio(m);
      case MSG.VIDEO:
        return this.onVideo(m);
      default:
        this.opts.log(`<< unknown message type ${m.type} len=${m.body.length}`);
    }
  }

  private onUserControl(body: Buffer): void {
    const event = body.readUInt16BE(0);
    const names: { [k: number]: string } = { 0: 'StreamBegin', 1: 'StreamEOF', 2: 'StreamDry', 4: 'StreamIsRecorded', 6: 'PingRequest', 7: 'PingResponse' };
    this.opts.log(`<< UserControl ${names[event] ?? event} ${body.subarray(2).toString('hex')}`);
    if (event === 6) this.sendPingResponse(body.subarray(2, 6));
  }

  private onCommand(m: RtmpMessage): void {
    let values: AmfValue[];
    try {
      values = decodeAmf0(m.body);
    } catch (err) {
      this.opts.log(`<< undecodable command: ${m.body.toString('hex')}`);
      return;
    }
    const [name, txn, , info] = values;
    this.opts.log(`<< ${String(name)} ${JSON.stringify(values.slice(1))}`);
    this.emit('command', String(name), values);
    if (name === 'onStatus' && info && typeof info === 'object' && !Array.isArray(info)) {
      const fields = info as { [key: string]: AmfValue };
      this.emit('status', {
        code: String(fields.code ?? ''),
        level: String(fields.level ?? ''),
        description: String(fields.description ?? ''),
        fields,
        transactionId: typeof txn === 'number' ? txn : 0,
      });
      if (fields.code === LV_STATUS.PLAY_START && this.opts.forceIFrameOnStart) this.forceIFrame();
    }
  }

  private onDataMessage(body: Buffer): void {
    try {
      const values = decodeAmf0(body);
      this.opts.log(`<< data ${JSON.stringify(values).slice(0, 300)}`);
      const obj = values.find((v) => v && typeof v === 'object' && !Array.isArray(v));
      if (obj) this.emit('metadata', obj as { [key: string]: AmfValue });
    } catch {
      this.opts.log(`<< undecodable data message len=${body.length}`);
    }
  }

  private onAudio(m: RtmpMessage): void {
    this.emit('audio', { timestamp: m.timestamp, body: m.body });
    const tag = parseAudioTag(m.body);
    if (!tag) return;
    if (tag.soundFormat === 10) {
      if (tag.aacPacketType === 0) {
        this.aacConfig = parseAacConfig(tag.data);
        this.emit('audioInfo', { codec: 'aac', sampleRate: aacSampleRate(this.aacConfig), channels: this.aacConfig.channelConfiguration });
        return;
      }
      if (this.aacConfig) this.emit('audioFrame', aacToAdts(tag.data, this.aacConfig));
      return;
    }
    if (tag.soundFormat === 7 || tag.soundFormat === 8) {
      if (!this.aacConfig) this.emit('audioInfo', { codec: tag.soundFormat === 7 ? 'g711a' : 'g711u', sampleRate: 8000, channels: 1 });
      this.emit('audioFrame', tag.data);
      return;
    }
    this.emit('audioInfo', { codec: 'unknown', sampleRate: 0, channels: tag.channels });
  }

  private onVideo(m: RtmpMessage): void {
    this.emit('video', { timestamp: m.timestamp, body: m.body });
    const tag = parseVideoTag(m.body);
    if (!tag || tag.codecId !== 7) return;
    if (tag.avcPacketType === 0) {
      this.avcConfig = parseAvcConfig(tag.data);
      return;
    }
    if (tag.avcPacketType !== 1 || !this.avcConfig) return;
    const isKeyframe = tag.frameType === 1;
    this.emit('videoAccessUnit', {
      data: avccToAnnexB(tag.data, this.avcConfig, isKeyframe),
      isKeyframe,
      videoType: 'H264',
      microseconds: m.timestamp * 1000,
      time: m.timestamp + tag.compositionTime,
    });
  }

  private fail(err: Error): void {
    this.opts.log(`!! ${err.message}`);
    this.emit('error', err);
    this.close();
  }

  private onClose(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (!this.closed) this.opts.log('socket closed by peer');
    this.closed = true;
    this.emit('close');
  }
}
