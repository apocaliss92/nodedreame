import { z } from 'zod';

/**
 * The third-video endpoints wrap their payload in a double `data` envelope:
 * `{ code, success, msg, data: { requestId, data: <payload> } }`. `code === 0`
 * means success (already enforced by the HTTP layer); these schemas narrow the
 * payload. All are permissive (`.passthrough()`) — the cloud adds fields freely.
 */

/** `tx/user/accesstoken` → `data.data = { token, userId, expireAt }` (expireAt: epoch seconds). */
export const VideoAccessTokenResponseSchema = z
  .object({
    code: z.number().optional(),
    msg: z.string().nullish(),
    data: z
      .object({
        data: z
          .object({
            token: z.string(),
            userId: z.union([z.string(), z.number()]).optional(),
            expireAt: z.number().optional(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();
export type VideoAccessTokenResponse = z.infer<typeof VideoAccessTokenResponseSchema>;

/** `aliIot/getAuthCodeV3` → `data` is a hex string (the Aliyun authCode blob). */
export const AuthCodeResponseSchema = z
  .object({
    code: z.number().optional(),
    msg: z.string().nullish(),
    data: z.string(),
  })
  .passthrough();
export type AuthCodeResponse = z.infer<typeof AuthCodeResponseSchema>;

/** `tx/mgr/family/getFamilyId` → `data.data.familyId`. */
export const FamilyIdResponseSchema = z
  .object({
    code: z.number().optional(),
    msg: z.string().nullish(),
    data: z
      .object({ data: z.object({ familyId: z.string() }).passthrough() })
      .passthrough(),
  })
  .passthrough();
export type FamilyIdResponse = z.infer<typeof FamilyIdResponseSchema>;

/**
 * `tx/mgr/dev/getIdentity` → the device's TENCENT IoT triple.
 *
 * Absent until the device is actually provisioned on `tx`: on 2026-09-05 this
 * endpoint answered `设备三元组不存在` ("the triple does not exist") for an X50
 * that was then on `ali`, and on 2026-09-16 the same device — moved to `tx` —
 * returned a full triple. So a failure here is a vendor statement, not a bug.
 */
export const TencentIdentityResponseSchema = z
  .object({
    code: z.number().optional(),
    msg: z.string().nullish(),
    data: z
      .object({
        data: z
          .object({
            productId: z.string(),
            deviceName: z.string(),
            deviceId: z.string().optional(),
            secretId: z.string().optional(),
            secretKey: z.string().optional(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();
export type TencentIdentityResponse = z.infer<typeof TencentIdentityResponseSchema>;

/**
 * `tx/dev/getP2PInfo` → the xp2p session descriptor.
 *
 * An OPAQUE string — measured at 35 characters on an X50, and NOT JSON: it is
 * the handle Tencent's xp2p SDK consumes, not a relay URL. Nothing here parses
 * it, because there is nothing in it we can read.
 */
export const TencentP2PInfoResponseSchema = z
  .object({
    code: z.number().optional(),
    msg: z.string().nullish(),
    data: z
      .object({ data: z.object({ p2pInfo: z.string() }).passthrough() })
      .passthrough(),
  })
  .passthrough();
export type TencentP2PInfoResponse = z.infer<typeof TencentP2PInfoResponseSchema>;

/** Nested `deviceInfo` block within a device record, carrying the video vendor hints. */
export const DeviceVideoInfoSchema = z
  .object({
    model: z.string().optional(),
    displayName: z.string().optional(),
    permit: z.string().optional(),
    videoDynamicVendor: z.boolean().optional(),
    defaultVendors: z.array(z.string()).optional(),
    productId: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

/** A device record as returned by `device/info` (`data` = single record). */
export const DeviceInfoRecordSchema = z
  .object({
    did: z.union([z.string(), z.number()]).optional(),
    model: z.string().optional(),
    customName: z.string().optional(),
    vendor: z.string().optional(),
    online: z.boolean().optional(),
    lwt: z.number().optional(),
    property: z.string().optional(),
    bindDomain: z.string().optional(),
    deviceInfo: DeviceVideoInfoSchema.optional(),
  })
  .passthrough();
export type DeviceInfoRecord = z.infer<typeof DeviceInfoRecordSchema>;

export const DeviceInfoResponseSchema = z
  .object({
    code: z.number().optional(),
    msg: z.string().nullish(),
    data: DeviceInfoRecordSchema,
  })
  .passthrough();
export type DeviceInfoResponse = z.infer<typeof DeviceInfoResponseSchema>;
