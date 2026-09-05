import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DreameCameraController,
  type MonitorActionCaller,
  type RelayMinter,
} from '../../../src/video/monitor/controller.js';

interface Call {
  siid: number;
  aiid: number;
  piid: number;
  value: Record<string, unknown>;
}

/** Decode a controller action call into (aiid, piid, parsed value). */
function decode(siid: number, aiid: number, input: unknown[]): Call {
  const entry = input[0] as { piid: number; value: unknown } | undefined;
  if (!entry) return { siid, aiid, piid: -1, value: {} };
  const value =
    typeof entry.value === 'string'
      ? (JSON.parse(entry.value) as Record<string, unknown>)
      : ({ raw: entry.value } as Record<string, unknown>);
  return { siid, aiid, piid: entry.piid, value };
}

/** A scriptable device + captured calls. `onStart` decides each startMonitor reply. */
function makeDevice(opts: {
  startReplies: unknown[]; // consumed per startMonitor (operation:'start') attempt
  keepAliveReply?: unknown | (() => unknown);
  verifyReply?: unknown;
}): { device: MonitorActionCaller; calls: Call[] } {
  const calls: Call[] = [];
  let startIdx = 0;
  const device: MonitorActionCaller = {
    callAction: vi.fn(async (siid: number, aiid: number, input: unknown[]) => {
      const c = decode(siid, aiid, input);
      calls.push(c);
      // startMonitor / stopMonitor share aiid1/piid1 — split on operation.
      if (aiid === 1 && c.piid === 1 && c.value['operation'] === 'start') {
        return opts.startReplies[startIdx++] ?? { code: 0 };
      }
      if (aiid === 1 && c.piid === 1 && c.value['operation'] === 'end') {
        return { code: 0, out: [{ piid: 1, value: 'ok' }] };
      }
      if (aiid === 1 && c.piid === 6) {
        const r = opts.keepAliveReply;
        return typeof r === 'function' ? (r as () => unknown)() : (r ?? { code: 0, out: [{ value: 'ok' }] });
      }
      if (aiid === 4 && c.piid === 1102) {
        return opts.verifyReply ?? { code: 0, out: [{ value: '{"code":2,"fail":0}' }] };
      }
      // access-code launch (4/1100) + initCameraSdk (7/11): benign priming acks.
      return { code: 0, out: [{ value: 1 }] };
    }),
  };
  return { device, calls };
}

const relayOk: RelayMinter = { getStreamInfo: vi.fn(async () => ({ relayUrl: 'rtmp://relay/live?token=x' })) };

function makeController(
  device: MonitorActionCaller,
  extra: Partial<ConstructorParameters<typeof DreameCameraController>[0]> = {},
): DreameCameraController {
  return new DreameCameraController({
    device,
    relay: relayOk,
    iotId: 'IOT',
    accountId: 'uid1',
    ...extra,
  });
}

describe('DreameCameraController', () => {
  it('opens with a single startMonitor when the device accepts it (no PIN)', async () => {
    const { device, calls } = makeDevice({ startReplies: [{ code: 0, out: [{ piid: 1, value: 'C_KEY' }] }] });
    const ctl = makeController(device);
    const handle = await ctl.open();

    expect(handle.rtmpUrl).toBe('rtmp://relay/live?token=x');
    expect(handle.encryptionKey).toBe('C_KEY');
    expect(ctl.isOpen).toBe(true);

    // Priming ran, exactly one startMonitor, no verifyAccessCode.
    const starts = calls.filter((c) => c.aiid === 1 && c.piid === 1 && c.value['operation'] === 'start');
    expect(starts).toHaveLength(1);
    expect(calls.some((c) => c.aiid === 4 && c.piid === 1102)).toBe(false);
    expect(calls.some((c) => c.aiid === 4 && c.piid === 1100)).toBe(true); // getAccessCodeLaunch
    expect(calls.some((c) => c.aiid === 7 && c.piid === 11)).toBe(true); // initCameraSdk

    await ctl.close();
    expect(ctl.isOpen).toBe(false);
  });

  it('satisfies the privacy gate: startMonitor -1 -> verifyAccessCode -> retry succeeds', async () => {
    const { device, calls } = makeDevice({
      startReplies: [{ code: -1 }, { code: 0, out: [{ piid: 1, value: 'C_KEY' }] }],
    });
    const ctl = makeController(device, { accessCode: '0000' });
    const handle = await ctl.open();

    expect(handle.encryptionKey).toBe('C_KEY');
    const starts = calls.filter((c) => c.aiid === 1 && c.piid === 1 && c.value['operation'] === 'start');
    expect(starts).toHaveLength(2);
    const verify = calls.find((c) => c.aiid === 4 && c.piid === 1102);
    expect(verify).toBeDefined();
    // The verified code is sha256("0000"), not the plaintext.
    expect(verify?.value['oldcode']).not.toBe('0000');
    expect(String(verify?.value['oldcode'])).toHaveLength(64);
    await ctl.close();
  });

  it('throws when startMonitor is refused and no accessCode is configured', async () => {
    const { device, calls } = makeDevice({ startReplies: [{ code: -1 }] });
    const ctl = makeController(device);
    await expect(ctl.open()).rejects.toThrow(/refused/);
    expect(ctl.isOpen).toBe(false);
    expect(calls.some((c) => c.aiid === 4 && c.piid === 1102)).toBe(false);
  });

  it('closes and throws when the monitor starts but no relay URL comes up', async () => {
    const { device, calls } = makeDevice({ startReplies: [{ code: 0, out: [{ value: 'K' }] }] });
    const relay: RelayMinter = { getStreamInfo: vi.fn(async () => ({ relayUrl: null })) };
    const ctl = makeController(device, { relay });
    await expect(ctl.open()).rejects.toThrow(/no relay/);
    expect(ctl.isOpen).toBe(false);
    // It cleaned up: a stopMonitor was sent.
    expect(calls.some((c) => c.aiid === 1 && c.piid === 1 && c.value['operation'] === 'end')).toBe(true);
  });

  it('rejects a second open while already open', async () => {
    const { device } = makeDevice({ startReplies: [{ code: 0, out: [{ value: 'K' }] }] });
    const ctl = makeController(device);
    await ctl.open();
    await expect(ctl.open()).rejects.toThrow(/already open/);
    await ctl.close();
  });

  it('close() sends stopMonitor and is idempotent', async () => {
    const { device, calls } = makeDevice({ startReplies: [{ code: 0, out: [{ value: 'K' }] }] });
    const ctl = makeController(device);
    await ctl.open();
    await ctl.close();
    await ctl.close(); // no throw, no extra stop
    const stops = calls.filter((c) => c.aiid === 1 && c.piid === 1 && c.value['operation'] === 'end');
    expect(stops).toHaveLength(1);
  });

  it('mintRelayUrl mints a fresh relay for an open monitor and rejects when closed', async () => {
    const { device } = makeDevice({ startReplies: [{ code: 0, out: [{ value: 'K' }] }] });
    let mints = 0;
    const relay: RelayMinter = {
      getStreamInfo: vi.fn(async () => ({ relayUrl: `rtmp://relay/live?n=${++mints}` })),
    };
    const ctl = makeController(device, { relay });
    await expect(ctl.mintRelayUrl()).rejects.toThrow(/not open/);
    await ctl.open();
    const u1 = await ctl.mintRelayUrl();
    const u2 = await ctl.mintRelayUrl();
    expect(u1).not.toBe(u2); // single-use: a fresh URL each call
    await ctl.close();
  });

  it('intercom + fill-light emit the reversed action shapes', async () => {
    const { device, calls } = makeDevice({ startReplies: [{ code: 0, out: [{ value: 'K' }] }] });
    const ctl = makeController(device);
    await ctl.open();
    await ctl.startIntercom({ videoCall: true });
    await ctl.setFillLight(60);
    await ctl.stopIntercom();
    await ctl.close();

    const intercomStart = calls.find(
      (c) => c.aiid === 2 && c.piid === 2 && c.value['operation'] === 'start',
    );
    expect(intercomStart?.value).toMatchObject({ operType: 'intercom', phone: 1 });
    const light = calls.find((c) => c.aiid === 3 && c.piid === 9);
    expect(light?.value['value']).toBe('60');
  });

  describe('camera-adjacent actions (active-stream gated)', () => {
    it('takePhoto issues the device-side snapshot action', async () => {
      const { device, calls } = makeDevice({ startReplies: [{ code: 0, out: [{ value: 'K' }] }] });
      const ctl = makeController(device);
      await ctl.open();
      await ctl.takePhoto();
      const photo = calls.find((c) => c.aiid === 1 && c.piid === 5);
      expect(photo?.value).toMatchObject({ operType: 'takephoto', operation: 'start' });
      await ctl.close();
    });

    it('drive sets the remote-drive property on siid 4 and rejects when closed', async () => {
      const { device } = makeDevice({ startReplies: [{ code: 0, out: [{ value: 'K' }] }] });
      const setProperty = vi.fn(async () => [{ code: 0 }]);
      (device as unknown as { setProperty: typeof setProperty }).setProperty = setProperty;
      const ctl = makeController(device);

      await expect(ctl.drive(200, 0)).rejects.toThrow(/not open/);
      await ctl.open();
      await ctl.driveDirection('forward');
      expect(setProperty).toHaveBeenCalledTimes(1);
      const write = setProperty.mock.calls[0]![0] as { siid: number; piid: number; value: string };
      expect(write.siid).toBe(4);
      expect(write.piid).toBe(15);
      const v = JSON.parse(write.value) as Record<string, unknown>;
      expect(v).toMatchObject({ spdv: 200, spdw: 0, audio: 'false' });
      await ctl.close();
    });

    it('person-follow start/stop hit siid 4 work/stop actions', async () => {
      const { device, calls } = makeDevice({ startReplies: [{ code: 0, out: [{ value: 'K' }] }] });
      const ctl = makeController(device);
      await ctl.open();
      await ctl.startPersonFollow();
      await ctl.stopPersonFollow();
      const start = calls.find((c) => c.siid === 4 && c.aiid === 1);
      expect(start).toBeDefined();
      expect(start?.piid).toBe(1);
      expect(start?.value).toEqual({ raw: 26 }); // piid1 value=26 (raw number, no session merge)
      expect(calls.some((c) => c.siid === 4 && c.aiid === 2)).toBe(true);
      await ctl.close();
    });
  });

  describe('keep-alive loop', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('ticks keep_alive on the configured cadence and reports tick failures', async () => {
      const onKeepAliveError = vi.fn();
      let kaCalls = 0;
      const { device, calls } = makeDevice({
        startReplies: [{ code: 0, out: [{ value: 'K' }] }],
        keepAliveReply: () => {
          kaCalls += 1;
          if (kaCalls === 2) throw new Error('device dropped');
          return { code: 0, out: [{ value: 'ok' }] };
        },
      });
      const ctl = makeController(device, { keepAliveIntervalMs: 1000, onKeepAliveError });
      await ctl.open();

      await vi.advanceTimersByTimeAsync(1000); // tick 1 ok
      await vi.advanceTimersByTimeAsync(1000); // tick 2 throws
      expect(onKeepAliveError).toHaveBeenCalledTimes(1);
      expect(calls.filter((c) => c.aiid === 1 && c.piid === 6).length).toBeGreaterThanOrEqual(2);

      await ctl.close();
      const before = calls.length;
      await vi.advanceTimersByTimeAsync(3000); // no more ticks after close
      expect(calls.length).toBe(before);
    });
  });
});
