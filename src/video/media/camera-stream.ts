/**
 * End-to-end camera media pipeline: autonomously cold-start the LinkVisual
 * monitor, connect to the resulting RTMP relay, and re-emit demuxed elementary
 * frames — H.264 access units (Annex-B, SPS/PPS prepended on keyframes) and AAC
 * (ADTS) — plus lifecycle events.
 *
 * This is the reusable frame feed for any external consumer (scrypted's RFC4571
 * muxer, camstack, a file writer). It owns the {@link DreameCameraController}
 * lifecycle: {@link start} opens the monitor and connects; {@link stop} closes
 * the relay socket and releases the monitor on the device.
 */
import { TypedEmitter } from '../../transport/typed-emitter.js';
import { DreameError } from '../../transport/errors.js';
import type { DreameCameraController } from '../monitor/controller.js';
import {
  LvRtmpClient,
  LV_STATUS,
  type AudioInfoEvent,
  type StatusEvent,
  type VideoAccessUnitEvent,
} from './lv-rtmp-client.js';
import { pcm16leToALaw } from './g711.js';

/** The subset of {@link LvRtmpClient} the pipeline drives — injectable for tests. */
export interface FrameSource {
  connect(): Promise<void>;
  close(): void;
  on(event: 'videoAccessUnit', cb: (e: VideoAccessUnitEvent) => void): void;
  on(event: 'audioFrame', cb: (buf: Buffer) => void): void;
  on(event: 'audioInfo', cb: (info: AudioInfoEvent) => void): void;
  on(event: 'status', cb: (e: StatusEvent) => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
  on(event: 'close', cb: () => void): void;
  /** Push an intercom (talk-back) audio frame upstream. */
  sendAudioFrame(payload: Buffer, tsMs: number, header?: number): void;
}

/** Factory for the RTMP frame source; defaults to a real {@link LvRtmpClient}. */
export type FrameSourceFactory = (url: string) => FrameSource;

export interface DreameCameraStreamEvents {
  /** Emitted once the relay is connected; carries the (single-use) RTMP URL. */
  started: [{ rtmpUrl: string }];
  /** One H.264 access unit (Annex-B). */
  videoAccessUnit: [VideoAccessUnitEvent];
  /** One audio frame (AAC in ADTS, or raw G.711). */
  audioFrame: [Buffer];
  /** Audio format, emitted once known. */
  audioInfo: [AudioInfoEvent];
  /** Emitted after the pipeline is fully torn down. */
  stopped: [];
  error: [Error];
  [event: string]: unknown[];
}

export interface DreameCameraStreamInput {
  /** A controller for the target camera (not yet opened). */
  controller: DreameCameraController;
  /** Override the RTMP client (tests inject a fake). */
  clientFactory?: FrameSourceFactory;
  /** Forwarded to {@link LvRtmpClient}: send NetStream.RequestAudioType after play. */
  requestAudioType?: boolean;
  /** Forwarded to {@link LvRtmpClient}: send periodic NetStream.Ping. */
  ping?: boolean;
  /** Optional line logger for the RTMP client. */
  log?: (line: string) => void;
}

export class DreameCameraStream extends TypedEmitter<DreameCameraStreamEvents> {
  readonly #controller: DreameCameraController;
  readonly #clientFactory: FrameSourceFactory;
  readonly #log: (line: string) => void;
  #client: FrameSource | null = null;
  #state: 'idle' | 'starting' | 'running' | 'stopping' = 'idle';
  #videoFrames = 0;
  #audioFrames = 0;
  #talkReady = false;
  #talkWaiters: Array<() => void> = [];
  #talkTs = 0;

  constructor(input: DreameCameraStreamInput) {
    super();
    this.#controller = input.controller;
    this.#log = input.log ?? ((): void => {});
    this.#clientFactory =
      input.clientFactory ??
      ((url: string): FrameSource =>
        new LvRtmpClient({
          url,
          ...(input.requestAudioType !== undefined ? { requestAudioType: input.requestAudioType } : {}),
          ...(input.ping !== undefined ? { ping: input.ping } : {}),
          ...(input.log ? { log: input.log } : {}),
        }));
  }

  /** True while frames are flowing. */
  get isRunning(): boolean {
    return this.#state === 'running';
  }

  /**
   * Cold-start the monitor, connect to the relay, and begin emitting frames.
   * Resolves once connected. Throws (and cleans up) if the monitor or relay
   * connection fails.
   */
  async start(): Promise<{ rtmpUrl: string }> {
    if (this.#state !== 'idle') {
      throw new DreameError(`camera stream cannot start from state '${this.#state}'`);
    }
    this.#state = 'starting';
    try {
      this.#log('[nodedreame:stream] starting');
      const handle = await this.#controller.open();
      const client = this.#clientFactory(handle.rtmpUrl);
      this.#client = client;
      client.on('videoAccessUnit', (e) => {
        this.#videoFrames += 1;
        if (this.#videoFrames === 1) this.#log('[nodedreame:stream] first video access unit');
        this.emit('videoAccessUnit', e);
      });
      client.on('audioFrame', (buf) => {
        this.#audioFrames += 1;
        if (this.#audioFrames === 1) this.#log('[nodedreame:stream] first audio frame');
        this.emit('audioFrame', buf);
      });
      client.on('audioInfo', (info) => {
        this.#log(`[nodedreame:stream] audio ${info.codec} ${info.sampleRate}Hz x${info.channels}`);
        this.emit('audioInfo', info);
      });
      client.on('status', (e) => {
        if (e.code === LV_STATUS.TALK_READY) {
          this.#log('[nodedreame:stream] talk channel ready');
          this.#talkReady = true;
          const waiters = this.#talkWaiters;
          this.#talkWaiters = [];
          for (const w of waiters) w();
        }
      });
      client.on('error', (err) => {
        this.#log(`[nodedreame:stream] rtmp error: ${err.message}`);
        this.emit('error', err);
      });
      client.on('close', () => {
        this.#log('[nodedreame:stream] upstream relay closed');
        // Upstream relay closed on us — tear down and surface as stopped.
        if (this.#state === 'running') void this.stop();
      });
      await client.connect();
      this.#state = 'running';
      this.#log('[nodedreame:stream] connected to relay');
      this.emit('started', { rtmpUrl: handle.rtmpUrl });
      return { rtmpUrl: handle.rtmpUrl };
    } catch (err) {
      this.#state = 'idle';
      await this.#safeTeardown();
      throw err;
    }
  }

  /** Close the relay connection and release the monitor. Idempotent. */
  async stop(): Promise<void> {
    if (this.#state === 'idle' || this.#state === 'stopping') return;
    this.#state = 'stopping';
    this.#log(`[nodedreame:stream] stopping (video=${this.#videoFrames} audio=${this.#audioFrames})`);
    await this.#safeTeardown();
    this.#state = 'idle';
    this.emit('stopped');
  }

  /**
   * Open the two-way intercom: send the MIoT start, then resolve once the relay
   * signals the talk channel is ready (so it's safe to {@link sendTalkPcm}).
   * Rejects if not ready within `timeoutMs`.
   */
  async startTalk(opts?: { needRecordSound?: boolean; videoCall?: boolean; timeoutMs?: number }): Promise<void> {
    if (this.#state !== 'running') throw new DreameError('stream is not running; start() first');
    this.#log('[nodedreame:stream] intercom start');
    await this.#controller.startIntercom(
      opts?.needRecordSound !== undefined || opts?.videoCall !== undefined
        ? { ...(opts.needRecordSound !== undefined ? { needRecordSound: opts.needRecordSound } : {}), ...(opts.videoCall ? { videoCall: true } : {}) }
        : undefined,
    );
    this.#talkTs = 0;
    await this.whenTalkReady(opts?.timeoutMs ?? 5000);
  }

  /** Resolve when the talk channel is ready (or reject on timeout). */
  whenTalkReady(timeoutMs = 5000): Promise<void> {
    if (this.#talkReady) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new DreameError('timed out waiting for TalkReady')), timeoutMs);
      timer.unref?.();
      this.#talkWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /**
   * Encode 16-bit LE mono PCM (8 kHz) to G.711 A-law and push it upstream.
   * `tsMs` defaults to a running clock advanced by the frame duration.
   */
  sendTalkPcm(pcm16le: Buffer, tsMs?: number): void {
    const alaw = pcm16leToALaw(pcm16le);
    this.sendTalkAlaw(alaw, tsMs);
  }

  /** Push raw A-law audio upstream (advancing the running talk clock). */
  sendTalkAlaw(alaw: Buffer, tsMs?: number): void {
    if (!this.#client) throw new DreameError('stream is not running');
    const ts = tsMs ?? this.#talkTs;
    this.#client.sendAudioFrame(alaw, ts);
    // A-law @ 8 kHz => 1 byte per sample => ms = samples/8.
    this.#talkTs = ts + Math.round(alaw.length / 8);
  }

  /** Close the two-way intercom (MIoT stop). */
  async stopTalk(): Promise<void> {
    this.#talkReady = false;
    this.#log('[nodedreame:stream] intercom stop');
    await this.#controller.stopIntercom();
  }

  async #safeTeardown(): Promise<void> {
    this.#talkReady = false;
    this.#talkWaiters = [];
    try {
      this.#client?.close();
    } catch {
      /* ignore */
    }
    this.#client = null;
    try {
      await this.#controller.close();
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }
}
