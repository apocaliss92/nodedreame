/**
 * Why a camera cannot be opened, said out loud.
 *
 * `createCameraController` threw one sentence for every cause —
 * "device has no LinkVisual iotId; not a camera device or not provisioned" —
 * and a CamStack operator hit it on a robot whose camera they had just enabled
 * in the Dreame app (2026-09-16). Working out what it meant took reading this
 * library's source: the sentence names a missing field, not a cause, and the
 * profile beside it already knows whether the device is a camera at all,
 * whether it is online, which vendor it is on and which it supports.
 *
 * Four states, four different things to do, and the message has to tell them
 * apart — a diagnostic that cannot be acted on is not a diagnostic.
 */
import { describe, it, expect } from 'vitest';
import { explainNoCameraChannel } from '../../src/video/camera-availability.js';
import type { DeviceVideoProfile } from '../../src/video/types.js';

function profile(over: Partial<DeviceVideoProfile> = {}): DeviceVideoProfile {
  return {
    did: 'DID_ABC',
    model: 'dreame.vacuum.r2538z',
    displayName: 'X50 Ultra Complete',
    videoCapable: true,
    currentVendor: 'ali',
    supportedVendors: ['tx', 'ali'],
    dynamicVendor: true,
    iotId: null,
    online: true,
    ...over,
  };
}

describe('explainNoCameraChannel', () => {
  it('says nothing when the channel is there — it is not this function’s business', () => {
    expect(explainNoCameraChannel(profile({ iotId: 'CHANNEL_1' }))).toBeNull();
  });

  // The model has no camera at all. Nothing the operator does to this device
  // will help; they are looking at the wrong device.
  it('names a device the cloud does not consider a camera', () => {
    const msg = explainNoCameraChannel(
      profile({ videoCapable: false, supportedVendors: [], currentVendor: null }),
    );
    expect(msg).toContain('not a camera');
    expect(msg).toContain('dreame.vacuum.r2538z');
  });

  // Offline: the binding is published by the device itself, so there is nothing
  // to fetch until it connects. Telling the operator to re-pair would be wrong.
  it('names an offline device rather than blaming provisioning', () => {
    const msg = explainNoCameraChannel(profile({ online: false })) ?? '';
    // The WORD, whatever its emphasis — the contract is that it names being
    // offline, not how the sentence chooses to shout it.
    expect(msg).toMatch(/offline/i);
    expect(msg).not.toContain('not a camera');
  });

  // THE OPERATOR'S CASE: a camera, online, and still no channel. The device has
  // not bound to the video service yet — which is what opening the camera once
  // in the vendor app does.
  it('tells an online camera with no binding what will create one', () => {
    const msg = explainNoCameraChannel(profile());
    expect(msg).toContain('no video channel');
    expect(msg).toContain('Dreame app');
  });

  // The facts a reader needs in order to argue with the verdict, on the line
  // that delivers it: which vendor it is on, which it supports.
  it('carries the vendor facts the verdict rests on', () => {
    const msg = explainNoCameraChannel(profile({ currentVendor: 'tx' })) ?? '';
    expect(msg).toContain('tx');
    expect(msg).toContain('ali');
  });

  // A device that supports video but is on NO vendor is a different shape from
  // one sitting on a vendor — and it is the shape a never-streamed camera has.
  it('says when the device sits on no vendor at all', () => {
    const msg = explainNoCameraChannel(profile({ currentVendor: null })) ?? '';
    expect(msg).toContain('none');
  });

  /**
   * THE CASE THAT COST A MORNING. Measured on a live X50 (dreame.vacuum.r2538z)
   * on 2026-09-16 while its owner was watching the stream in the Dreame app:
   *
   *   videoCapable: true, online: true, currentVendor: 'tx',
   *   supportedVendors: ['tx','ali'], iotId: null
   *
   * The device is provisioned and streaming — over TENCENT. `iotId` is read
   * from the ALIYUN bind endpoint (`iotuserbind/device/info`), so for a `tx`
   * device it is absent by construction and will never appear, whatever the
   * owner does in the app.
   *
   * The advice "open it once in the app to create the binding" is therefore
   * WRONG here, and it was given: the owner had the app streaming at that very
   * moment. A diagnostic that sends someone to do something that cannot work
   * is worse than one that says nothing.
   */
  it('names the vendor gap instead of telling the owner to re-pair', () => {
    const msg = explainNoCameraChannel(profile({ currentVendor: 'tx' })) ?? '';
    expect(msg).toContain('tx');
    expect(msg).toMatch(/aliyun/i);
    // It must NOT repeat the advice that cannot help a `tx` device.
    expect(msg).not.toMatch(/open its camera once in the Dreame app/i);
  });

  // …and the advice must SURVIVE for the case it is actually right for: a
  // camera on no vendor at all has simply never streamed.
  it('keeps the app advice for a device bound to nothing', () => {
    const msg = explainNoCameraChannel(profile({ currentVendor: null })) ?? '';
    expect(msg).toMatch(/Dreame app/i);
  });
});
