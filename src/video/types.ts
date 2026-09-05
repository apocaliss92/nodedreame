/**
 * Public types for the video control-plane. The Dreamehome cloud fronts several
 * camera backends ("vendors"); a device advertises which ones it supports and
 * which one it is currently provisioned on. This module models only the
 * control-plane (token + session negotiation); the media transport per vendor
 * is built on top of it.
 */

/** Camera backend a device streams through. `tx` = Tencent, `ali` = Aliyun LinkVisual. */
export type VideoVendor = 'tx' | 'ali';

/** Short-lived token minted by `tx/user/accesstoken`, used by the video endpoints. */
export interface VideoAccessToken {
  /** Opaque bearer for the third-video service (distinct from the account token). */
  readonly token: string;
  /** Numeric video-service user id, as a string. */
  readonly userId: string | null;
  /** Epoch-ms at which {@link token} expires (converted from the cloud's epoch-seconds). */
  readonly expiresAt: number;
}

/**
 * A device's video profile, derived from its cloud record. Tells you whether the
 * device has a camera, which vendors it supports, which one it is on now, and —
 * when on Aliyun — its LinkVisual `iotId` (the id every LinkVisual call needs).
 */
export interface DeviceVideoProfile {
  /** Dreame device id (the `did`). */
  readonly did: string;
  /** Model code, e.g. `dreame.vacuum.r2538z`. */
  readonly model: string;
  /** Human product name, e.g. `X50 Ultra Complete`. */
  readonly displayName: string | null;
  /** True when the device exposes a camera stream (`permit === "video"`). */
  readonly videoCapable: boolean;
  /** The vendor the device is currently provisioned on (`''` in the record → null). */
  readonly currentVendor: VideoVendor | null;
  /** Vendors the device can use, in cloud-declared order. */
  readonly supportedVendors: readonly VideoVendor[];
  /** True when the cloud picks the vendor dynamically at session time. */
  readonly dynamicVendor: boolean;
  /** Aliyun LinkVisual device id, when the device is on (or has been on) Aliyun. */
  readonly iotId: string | null;
  /** Whether the device is online. */
  readonly online: boolean;
}
