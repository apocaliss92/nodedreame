import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { DreameCameraStream, type FrameSource } from '../../../src/video/media/camera-stream.js';
import type { DreameCameraController } from '../../../src/video/monitor/controller.js';

/** A fake RTMP frame source: an EventEmitter with connect()/close(). */
class FakeSource extends EventEmitter implements FrameSource {
  connect = vi.fn(async () => {});
  close = vi.fn(() => {});
}

/** A fake controller recording open/close. */
function fakeController(overrides: Partial<{ open: () => Promise<unknown>; close: () => Promise<void> }> = {}) {
  const open = vi.fn(overrides.open ?? (async () => ({ rtmpUrl: 'rtmp://relay/live', encryptionKey: 'K' })));
  const close = vi.fn(overrides.close ?? (async () => {}));
  return { open, close } as unknown as DreameCameraController & { open: typeof open; close: typeof close };
}

describe('DreameCameraStream', () => {
  it('starts: opens the monitor, connects, and re-emits frames', async () => {
    const controller = fakeController();
    const source = new FakeSource();
    const stream = new DreameCameraStream({ controller, clientFactory: () => source });

    const started = vi.fn();
    const aus: unknown[] = [];
    stream.on('started', started);
    stream.on('videoAccessUnit', (e) => aus.push(e));

    const res = await stream.start();
    expect(res.rtmpUrl).toBe('rtmp://relay/live');
    expect(controller.open).toHaveBeenCalledTimes(1);
    expect(source.connect).toHaveBeenCalledTimes(1);
    expect(started).toHaveBeenCalledWith({ rtmpUrl: 'rtmp://relay/live' });
    expect(stream.isRunning).toBe(true);

    source.emit('videoAccessUnit', { data: Buffer.from([0]), isKeyframe: true, videoType: 'H264', microseconds: 0 });
    expect(aus).toHaveLength(1);

    await stream.stop();
    expect(controller.close).toHaveBeenCalledTimes(1);
    expect(source.close).toHaveBeenCalledTimes(1);
    expect(stream.isRunning).toBe(false);
  });

  it('tears down when the upstream relay closes', async () => {
    const controller = fakeController();
    const source = new FakeSource();
    const stream = new DreameCameraStream({ controller, clientFactory: () => source });
    const stopped = vi.fn();
    stream.on('stopped', stopped);

    await stream.start();
    source.emit('close'); // upstream drop
    await vi.waitFor(() => expect(stopped).toHaveBeenCalled());
    expect(controller.close).toHaveBeenCalled();
    expect(stream.isRunning).toBe(false);
  });

  it('cleans up and rethrows when the monitor fails to open', async () => {
    const controller = fakeController({ open: async () => { throw new Error('offline'); } });
    const factory = vi.fn(() => new FakeSource());
    const stream = new DreameCameraStream({ controller, clientFactory: factory });

    await expect(stream.start()).rejects.toThrow(/offline/);
    expect(stream.isRunning).toBe(false);
    // controller.close is called during cleanup even though open threw.
    expect(controller.close).toHaveBeenCalled();
    // no client was created because open failed first
    expect(factory).not.toHaveBeenCalled();
  });

  it('rejects a second start while running and stop() is idempotent', async () => {
    const controller = fakeController();
    const stream = new DreameCameraStream({ controller, clientFactory: () => new FakeSource() });
    await stream.start();
    await expect(stream.start()).rejects.toThrow(/cannot start/);
    await stream.stop();
    await stream.stop(); // no throw
    expect(controller.close).toHaveBeenCalledTimes(1);
  });
});
