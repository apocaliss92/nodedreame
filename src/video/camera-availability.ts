import type { DeviceVideoProfile } from './types.js';

/**
 * Why this device cannot open a camera channel — or `null` when it can.
 *
 * The camera path needs one thing from the cloud: the `iotId`, which is the
 * CHANNEL id `startMonitor` addresses (for both vendors — see
 * `startMonitorParams`). When it is absent the call cannot proceed, and for a
 * long time that was reported as a single sentence covering four different
 * situations:
 *
 *   "device has no LinkVisual iotId; not a camera device or not provisioned"
 *
 * A CamStack operator met it on a robot whose camera they had just enabled in
 * the Dreame app (2026-09-16). Working out which of the four they were in
 * meant reading this library's source — the sentence names a MISSING FIELD,
 * not a cause, and the profile sitting right next to it already knows whether
 * the device is a camera at all, whether it is online, and which vendors it is
 * on and supports.
 *
 * The four states want four different actions:
 *
 *   - not a camera        → wrong device; nothing done here will help
 *   - offline             → wait; the binding is published BY the device
 *   - camera, online, no channel → open it once in the vendor app, which is
 *                           what creates the binding
 *   - channel present     → not this function's business
 *
 * Pure, so it is testable against captured profiles without a cloud.
 */
export function explainNoCameraChannel(profile: DeviceVideoProfile): string | null {
  if (profile.iotId) {
    return null;
  }
  const who = `${profile.model || 'unknown model'} (${profile.did || 'no did'})`;
  if (!profile.videoCapable) {
    return (
      `${who} is not a camera: the cloud lists no video permit and no supported ` +
      `video vendor for it, so there is no channel to open.`
    );
  }
  if (!profile.online) {
    return (
      `${who} is a camera but is OFFLINE. The video binding is published by the ` +
      `device itself, so there is nothing to read until it connects — this is ` +
      `not a provisioning fault.`
    );
  }
  const supports = profile.supportedVendors.length > 0 ? profile.supportedVendors.join(', ') : 'none';
  // ON A VENDOR WE DO NOT SPEAK.
  //
  // `iotId` is read from the ALIYUN bind endpoint (`iotuserbind/device/info`),
  // so a device provisioned on Tencent has none BY CONSTRUCTION — it is not
  // missing, it does not live there. Measured on a live X50 on 2026-09-16
  // while its owner was watching the stream in the Dreame app: `vendor: 'tx'`,
  // `supports: ['tx','ali']`, `iotId: null`.
  //
  // Telling that owner to "open it once in the app to create the binding" is
  // advice that cannot work, and it was given — while the app was streaming.
  // A diagnostic that sends someone to do a useless thing is worse than one
  // that says nothing, so this case says what is actually true.
  if (profile.currentVendor === 'tx') {
    return (
      `${who} is a camera and online, but is provisioned on the TENCENT video ` +
      `vendor (vendor: tx; supports: ${supports}), and this library implements ` +
      `only the Aliyun LinkVisual path — the channel id it needs lives on ` +
      `Aliyun and a tx device has none. Re-pairing or re-opening the camera in ` +
      `the app will not change this.`
    );
  }
  // A camera, online, on no vendor at all: it has never bound to the video
  // service. Streaming it once in the vendor app is what creates the binding —
  // and here that advice is right.
  const on = profile.currentVendor ?? 'none';
  return (
    `${who} is a camera and online, but has no video channel yet ` +
    `(vendor: ${on}; supports: ${supports}). The device has not bound to the ` +
    `video service — open its camera once in the Dreame app to create the ` +
    `binding, then retry.`
  );
}
