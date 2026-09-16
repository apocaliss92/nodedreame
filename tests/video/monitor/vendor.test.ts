/**
 * The vendor decides which media plane exists, so reading it wrong is not a
 * cosmetic error — it sends the caller down a stack the device does not speak.
 *
 * Shapes from the decompiled app (`videoVendorStatus`, property 11) and from a
 * live X50 on 2026-09-16.
 */
import { describe, it, expect } from 'vitest';

import {
  parseVideoVendorStatus,
  vendorSwitchSettled,
  videoVendorSwitchParams,
} from '../../../src/video/monitor/vendor.js';

describe('videoVendorSwitchParams', () => {
  /**
   * `{vendor}` SWITCHES; the same action with `null` merely initialises the
   * vendor the device already sits on — which is what the controller's prime
   * step has always sent. One value apart, two different operations, so the
   * params must carry the vendor and nothing else.
   */
  it('carries the vendor, and only the vendor', () => {
    expect(videoVendorSwitchParams('ali')).toEqual({ vendor: 'ali' });
    expect(videoVendorSwitchParams('tx')).toEqual({ vendor: 'tx' });
  });
});

describe('parseVideoVendorStatus', () => {
  // The device answers a JSON STRING inside the property value, like every
  // other status on this service.
  it('reads the stringified status the device actually sends', () => {
    const s = parseVideoVendorStatus('{"vendor":"tx","initStatus":1}');
    expect(s.vendor).toBe('tx');
    expect(s.initStatus).toBe(1);
  });

  it('reads an already-parsed object too', () => {
    expect(parseVideoVendorStatus({ vendor: 'ali', initStatus: 0 })).toEqual({
      vendor: 'ali',
      initStatus: 0,
    });
  });

  /**
   * NEVER THROWS. A caller polls this every few seconds while a switch
   * settles; dying on one malformed tick would abandon a switch that was
   * about to succeed. Unknown is `null`, which is the truth.
   */
  it('answers "unknown" instead of throwing, on anything unreadable', () => {
    for (const bad of ['', 'not json', '{', null, undefined, 42, []]) {
      expect(parseVideoVendorStatus(bad)).toEqual({ vendor: null, initStatus: null });
    }
  });

  // A vendor the library does not model (the app's constants also list
  // `agora`) must read as unknown rather than be passed along as if we could
  // stream it.
  it('refuses a vendor it cannot speak', () => {
    expect(parseVideoVendorStatus('{"vendor":"agora","initStatus":1}').vendor).toBeNull();
  });
});

describe('vendorSwitchSettled', () => {
  /**
   * `initStatus === 1` is the whole point: the app polls every 5 s up to ten
   * times precisely because the device reports the NEW vendor before its SDK
   * is up, and acting then is what a half-switched device looks like.
   */
  it('is not settled until the SDK reports itself up', () => {
    expect(vendorSwitchSettled({ vendor: 'ali', initStatus: 0 }, 'ali')).toBe(false);
    expect(vendorSwitchSettled({ vendor: 'ali', initStatus: 1 }, 'ali')).toBe(true);
  });

  it('is not settled while the device still reports the old vendor', () => {
    expect(vendorSwitchSettled({ vendor: 'tx', initStatus: 1 }, 'ali')).toBe(false);
  });

  it('is not settled on an unknown status', () => {
    expect(vendorSwitchSettled({ vendor: null, initStatus: null }, 'ali')).toBe(false);
  });
});

/**
 * `setVideoVendor` on a fake device: the WAITING is the contract.
 *
 * The device reports the new vendor before its SDK is up — which is why the
 * app polls rather than trusting the action's return. Resolving early hands
 * the caller a robot that names a backend it cannot yet serve.
 */
import { VacuumDevice } from '../../../src/models/vacuum/vacuum-device.js';

interface FakeCall {
  readonly siid: number;
  readonly aiid: number;
  readonly input: unknown[];
}

/**
 * A VacuumDevice whose transport is scripted. `statuses` is consumed one per
 * live read, so a test says exactly what the device reports and when.
 */
function fakeVacuum(statuses: readonly unknown[]): {
  device: VacuumDevice;
  calls: FakeCall[];
  reads: number;
} {
  const calls: FakeCall[] = []
  const state = { reads: 0 }
  const device = Object.create(VacuumDevice.prototype) as VacuumDevice
  Object.assign(device, {
    // `currentSession` is protected on the real device; the switch reads it to
    // mint the monitor session the payload must carry.
    currentSession: () => ({ uid: 'u1', accessToken: 'A', expiresAt: 0, region: 'eu' }),
    callAction: async (siid: number, aiid: number, input: unknown[]) => {
      calls.push({ siid, aiid, input })
      return { code: 0 }
    },
    refreshProperties: async () => {
      const v = statuses[Math.min(state.reads, statuses.length - 1)]
      state.reads += 1
      return [{ value: v }]
    },
    refreshCachedProperties: async () => [{ value: statuses[0] }],
  })
  return { device, calls, get reads() { return state.reads } }
}

describe('setVideoVendor', () => {
  it('does nothing at all when the robot is already there', async () => {
    const f = fakeVacuum(['{"vendor":"ali","initStatus":1}'])
    const out = await f.device.setVideoVendor('ali')
    expect(out.vendor).toBe('ali')
    // No action sent: switching a robot that is already switched would cost a
    // real SDK re-init for nothing.
    expect(f.calls).toHaveLength(0)
  })

  it('sends the switch and waits for initStatus to reach 1', async () => {
    const f = fakeVacuum([
      '{"vendor":"tx","initStatus":1}', // before
      '{"vendor":"ali","initStatus":0}', // named, SDK not up yet
      '{"vendor":"ali","initStatus":1}', // settled
    ])
    const out = await f.device.setVideoVendor('ali', { pollIntervalMs: 1, timeoutMs: 500 })
    expect(out).toEqual({ vendor: 'ali', initStatus: 1 })
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]?.siid).toBe(10001)
    expect(f.calls[0]?.aiid).toBe(7)

    /**
     * THE PAYLOAD SHAPE, not merely its contents.
     *
     * The device wants `value` as a JSON STRING carrying a `session`; an
     * object without one is SILENTLY IGNORED — measured on an X50 on
     * 2026-09-16, which stayed on `tx` with `initStatus: 1` and never
     * protested. The first version of this test asserted only that the
     * serialised input contained `"vendor":"ali"`, which is true of the broken
     * shape too — a fake that accepts what production got wrong.
     */
    const entry = f.calls[0]?.input[0] as { piid: number; value: unknown }
    expect(entry.piid).toBe(11)
    expect(typeof entry.value).toBe('string')
    const sent: unknown = JSON.parse(String(entry.value))
    expect(sent).toMatchObject({ vendor: 'ali' })
    expect(typeof (sent as { session?: unknown }).session).toBe('string')
  })

  /**
   * A device that cannot move must FAIL, loudly. Reporting success on a robot
   * still sitting on the old backend is how a caller ends up talking to a
   * media plane that is not there.
   */
  it('throws rather than pretending, when it never settles', async () => {
    const f = fakeVacuum(['{"vendor":"tx","initStatus":1}'])
    await expect(
      f.device.setVideoVendor('ali', { pollIntervalMs: 1, timeoutMs: 20 }),
    ).rejects.toThrow(/did not settle/i)
  })
})
