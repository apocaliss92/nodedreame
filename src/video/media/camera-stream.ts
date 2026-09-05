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
  type AudioInfoEvent,
  type VideoAccessUnitEvent,
} from './lv-rtmp-client.js';

/** The subset of {@link LvRtmpClient} the pipeline drives — injectable for tests. */
export interface FrameSource {
  connect(): Promise<void>;
  close(): void;
  on(event: 'videoAccessUnit', cb: (e: VideoAccessUnitEvent) => void): void;
  on(event: 'audioFrame', cb: (buf: Buffer) => void): void;
  on(event: 'audioInfo', cb: (info: AudioInfoEvent) => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
  on(event: 'close', cb: () => void): void;
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
  #client: FrameSource | null = null;
  #state: 'idle' | 'starting' | 'running' | 'stopping' = 'idle';

  constructor(input: DreameCameraStreamInput) {
    super();
    this.#controller = input.controller;
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
      const handle = await this.#controller.open();
      const client = this.#clientFactory(handle.rtmpUrl);
      this.#client = client;
      client.on('videoAccessUnit', (e) => this.emit('videoAccessUnit', e));
      client.on('audioFrame', (buf) => this.emit('audioFrame', buf));
      client.on('audioInfo', (info) => this.emit('audioInfo', info));
      client.on('error', (err) => this.emit('error', err));
      client.on('close', () => {
        // Upstream relay closed on us — tear down and surface as stopped.
        if (this.#state === 'running') void this.stop();
      });
      await client.connect();
      this.#state = 'running';
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
    await this.#safeTeardown();
    this.#state = 'idle';
    this.emit('stopped');
  }

  async #safeTeardown(): Promise<void> {
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
