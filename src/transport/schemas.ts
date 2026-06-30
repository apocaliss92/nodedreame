import { z } from 'zod';

/** OAuth token endpoint response. Permissive: Dreame may add fields. */
export const OAuthTokenResponseSchema = z
  .object({
    access_token: z.string().optional(),
    refresh_token: z.string().optional(),
    expires_in: z.number().optional(),
    token_type: z.string().optional(),
    uid: z.union([z.string(), z.number()]).optional(),
    region: z.string().optional(),
    country: z.string().optional(),
    lang: z.string().optional(),
    tenant_id: z.string().optional(),
    error: z.string().optional(),
    error_description: z.string().optional(),
    code: z.number().optional(),
    msg: z.string().nullish(),
  })
  .passthrough();
export type OAuthTokenResponse = z.infer<typeof OAuthTokenResponseSchema>;

/** Single raw device record from the device-list endpoint. */
export const RawDeviceSchema = z
  .object({
    did: z.union([z.string(), z.number()]).optional(),
    model: z.string().optional(),
    customName: z.string().optional(),
    deviceName: z.string().optional(),
    mac: z.string().optional(),
    online: z.boolean().optional(),
    lwt: z.number().optional(),
    bindDomain: z.string().optional(),
    master: z.boolean().optional(),
  })
  .passthrough();
export type RawDevice = z.infer<typeof RawDeviceSchema>;

export const DeviceListResponseSchema = z
  .object({
    code: z.number().optional(),
    msg: z.string().nullish(),
    data: z
      .object({
        page: z
          .object({ records: z.array(RawDeviceSchema).optional() })
          .partial()
          .optional(),
        records: z.array(RawDeviceSchema).optional(),
      })
      .passthrough()
      .optional(),
    records: z.array(RawDeviceSchema).optional(),
  })
  .passthrough();
export type DeviceListResponse = z.infer<typeof DeviceListResponseSchema>;

/**
 * Per-property result. Lenient by design: every known field is OPTIONAL and
 * extra keys pass through. This validates the STRUCTURE (each element must be
 * an object) without rejecting real cloud responses whose exact shape we have
 * not fully observed — the command path is not exercised by the live e2e.
 */
export const PropertyResultSchema = z
  .object({
    siid: z.number().optional(),
    piid: z.number().optional(),
    value: z.unknown().optional(),
    code: z.number().optional(),
  })
  .passthrough();

/**
 * Single cloud-shadow entry from `dreame-user-iot/iotstatus/props`. The cloud
 * returns the last-known value as a STRING (e.g. `"100"`, `"true"`); the value
 * is widened to `unknown` and coerced by the command layer. `updateDate` is the
 * epoch-ms the cloud last saw that value (used for cache-age reporting).
 */
export const CachedPropEntrySchema = z
  .object({
    key: z.string(),
    value: z.unknown().optional(),
    updateDate: z.number().optional(),
  })
  .passthrough();
export type CachedPropEntry = z.infer<typeof CachedPropEntrySchema>;

/**
 * Cloud-shadow read response (`iotstatus/props`). `data` is an ARRAY of
 * per-property entries (NOT the nested `data.result` shape `sendCommand`
 * returns). Permissive: missing props are simply absent; on an error code
 * `data` may be absent entirely.
 */
export const CachedPropsResponseSchema = z
  .object({
    code: z.number().optional(),
    msg: z.string().nullish(),
    data: z.array(CachedPropEntrySchema).optional(),
  })
  .passthrough();
export type CachedPropsResponse = z.infer<typeof CachedPropsResponseSchema>;

export const SendCommandResponseSchema = z
  .object({
    code: z.number().optional(),
    msg: z.string().nullish(),
    data: z.object({ result: z.unknown().optional() }).passthrough().optional(),
    result: z.unknown().optional(),
  })
  .passthrough();
export type SendCommandResponse = z.infer<typeof SendCommandResponseSchema>;

/** Raw MQTT envelope as received from the broker, before flattening. */
export const RawMqttEventSchema = z
  .object({
    id: z.number().optional(),
    did: z.union([z.string(), z.number()]).optional(),
    data: z
      .object({
        id: z.number().optional(),
        method: z.string().optional(),
        params: z.unknown().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type RawMqttEvent = z.infer<typeof RawMqttEventSchema>;
