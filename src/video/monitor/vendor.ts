import type { VideoVendor } from '../types.js';

/**
 * Switching a device between its video backends.
 *
 * ## Why this exists
 *
 * A Dreame robot can be provisioned on Aliyun LinkVisual (`ali`) or Tencent
 * IoT-Video (`tx`), and a dual-vendor device (`videoDynamicVendor: true`,
 * `defaultVendors: ['tx','ali']`) moves between them. Which one it sits on is
 * not cosmetic: the two have entirely different media planes. Measured on an
 * X50 on 2026-09-16, while it sat on `tx`:
 *
 *   tx/dev/getRtcInfo  → 404      (the TRTC path does not exist for it)
 *   tx/dev/getP2PInfo  → an opaque 35-char xp2p handle
 *
 * so a `tx` device can only be streamed through Tencent's proprietary UDP P2P
 * stack, while the SAME device on `ali` streams through a plain RTMP relay this
 * library already implements end to end.
 *
 * The app switches with the very action this module builds — its own internal
 * debug page calls `changeVideoVendor('tx'|'ali')` — and then polls the status
 * until the device reports the new SDK initialised.
 *
 * ## The action
 *
 * `MONITOR_AIID.VIDEO_VENDOR` with `{vendor}` SWITCHES; the same action with
 * `null` merely initialises whatever vendor the device is already on, which is
 * what `#tryPrime` has always done. One value apart, two different operations.
 */

/** Params for the vendor-switch action. `null` params init the current vendor
 *  instead, which is a different operation — see the module docblock. */
export function videoVendorSwitchParams(vendor: VideoVendor): Record<string, unknown> {
  return { vendor };
}

/** What the device reports about its video SDK. */
export interface VideoVendorStatus {
  readonly vendor: VideoVendor | null;
  /** `1` once the SDK for {@link vendor} is up. A switch is not done until this. */
  readonly initStatus: number | null;
}

/**
 * Parse `videoVendorStatus` (property 11) — a JSON STRING inside the property
 * value, as every status on this service is.
 *
 * Never throws: an unreadable status is "we do not know", and a caller that
 * polls must not die on one malformed tick.
 */
export function parseVideoVendorStatus(raw: unknown): VideoVendorStatus {
  const text =
    typeof raw === 'string' ? raw : typeof raw === 'object' && raw !== null ? null : null;
  const source: unknown = text === null ? raw : safeJson(text);
  if (typeof source !== 'object' || source === null) {
    return { vendor: null, initStatus: null };
  }
  const v: unknown = Reflect.get(source, 'vendor');
  const s: unknown = Reflect.get(source, 'initStatus');
  return {
    vendor: v === 'ali' || v === 'tx' ? v : null,
    initStatus: typeof s === 'number' ? s : null,
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** True when the device reports the requested vendor, initialised. */
export function vendorSwitchSettled(status: VideoVendorStatus, wanted: VideoVendor): boolean {
  return status.vendor === wanted && status.initStatus === 1;
}
