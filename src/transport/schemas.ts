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
    msg: z.string().optional(),
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
    msg: z.string().optional(),
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

/** Per-property result. `value`/extra keys are tolerated. */
export const PropertyResultSchema = z
  .object({
    siid: z.number(),
    piid: z.number(),
    value: z.unknown().optional(),
    code: z.number().optional(),
  })
  .passthrough();

export const SendCommandResponseSchema = z
  .object({
    code: z.number().optional(),
    msg: z.string().optional(),
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
