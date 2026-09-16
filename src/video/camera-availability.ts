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
  // A camera, online, and still no channel: it has never bound to the video
  // service. Streaming it once in the vendor app is what creates the binding.
  const on = profile.currentVendor ?? 'none';
  const supports = profile.supportedVendors.length > 0 ? profile.supportedVendors.join(', ') : 'none';
  return (
    `${who} is a camera and online, but has no video channel yet ` +
    `(vendor: ${on}; supports: ${supports}). The device has not bound to the ` +
    `video service — open its camera once in the Dreame app to create the ` +
    `binding, then retry.`
  );
}
