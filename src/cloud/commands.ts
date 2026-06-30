import type { DreameRegion } from '../auth/config.js';
import type {
  DreameSession,
  MiotProp,
  MiotAction,
  PropertyWrite,
  PropertyResult,
} from './types.js';
import { COMMAND_FROM_FIELD, IOT_COM_PREFIX_DREAME } from '../auth/config.js';
import { randomRequestId } from '../transport/crypto.js';
import { DreameApiError } from '../transport/errors.js';
import {
  httpPostJsonBody,
  RequestContext,
  type BaseResponse,
  type FetchImpl,
} from '../transport/http.js';
import { z } from 'zod';
import {
  SendCommandResponseSchema,
  CachedPropsResponseSchema,
  BatchDeviceDataResponseSchema,
  PropertyResultSchema,
  type SendCommandResponse,
} from '../transport/schemas.js';

interface SendCommandInput {
  session: DreameSession;
  region: DreameRegion;
  did: string;
  /** MIoT method: `get_properties`, `set_properties`, `action`. */
  method: string;
  /**
   * For `get_properties`/`set_properties`: an ARRAY of property descriptors.
   * For `action`: a single OBJECT (NOT an array — Dreame surfaces the wrong
   * shape as a misleading code 80001 "device offline" error).
   */
  params: unknown;
  ctx?: RequestContext;
  country?: string;
  lang?: string;
  apiHost?: string;
  iotComPrefix?: number;
  fetchImpl?: FetchImpl;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Low-level dispatch to `/device/sendCommand`. Caller owns the `params` shape. */
export async function sendCommand(input: SendCommandInput): Promise<SendCommandResponse> {
  const ctx = input.ctx ?? RequestContext.from({ ...input, host: input.apiHost });
  const prefix = input.iotComPrefix ?? IOT_COM_PREFIX_DREAME;
  const id = randomRequestId();

  // The response is validated/narrowed by `SendCommandResponseSchema.parse`
  // below; the HTTP layer only needs the minimal `BaseResponse` shape. The
  // zod-inferred `SendCommandResponse` cannot be the generic directly because
  // its passthrough widening makes `code` `number | undefined`, which is
  // incompatible with `BaseResponse.code?: number` under exactOptionalPropertyTypes.
  const raw = await httpPostJsonBody<BaseResponse>({
    ctx,
    path: `/dreame-iot-com-${prefix}/device/sendCommand`,
    accessToken: input.session.accessToken,
    body: {
      did: input.did,
      id,
      data: {
        did: input.did,
        id,
        method: input.method,
        params: input.params,
        from: COMMAND_FROM_FIELD,
      },
    },
    context: input.method,
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
  });
  return SendCommandResponseSchema.parse(raw);
}

export interface CommonInput {
  session: DreameSession;
  region: DreameRegion;
  did: string;
  ctx?: RequestContext;
  country?: string;
  lang?: string;
  apiHost?: string;
  /**
   * Inject a fetch implementation. Placed here (on `CommonInput`) so tests can
   * pass a mock via the first argument without any casts. Do NOT put this on
   * `CallOptions` — it belongs on the base/donor argument only.
   */
  fetchImpl?: FetchImpl;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface CallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  // fetchImpl intentionally NOT here — inject it via CommonInput instead.
}

/** Read one or more MIoT properties from a device. */
export async function getProperties(
  base: CommonInput,
  props: MiotProp[],
  opts: CallOptions = {},
): Promise<PropertyResult[]> {
  const params = props.map((p) => ({ did: base.did, siid: p.siid, piid: p.piid }));
  const res = await sendCommand({ ...base, ...opts, method: 'get_properties', params });
  return extractResultArray(res, 'get_properties');
}

/**
 * Read the CLOUD-CACHED (shadow) values of one or more MIoT properties WITHOUT
 * waking the device. Hits the `dreame-user-iot/iotstatus/props` endpoint (the
 * account-auth path, NOT the `device/sendCommand` envelope), which returns the
 * cloud's last-known values for a standby/offline robot and never 80001s for an
 * idle device — exactly what the Dreamehome app shows for a sleeping robot.
 *
 * `keys` MUST be the comma-joined `"siid.piid"` STRING (an array yields code
 * 10001; an empty value yields 10007). Each `data[]` entry's `value` arrives as
 * a STRING; it is coerced back to number/boolean (else kept as a string) so the
 * existing typed getters (which expect numbers) decode it unchanged.
 */
export async function getCachedProperties(
  base: CommonInput,
  props: MiotProp[],
  opts: CallOptions = {},
): Promise<PropertyResult[]> {
  const ctx = base.ctx ?? RequestContext.from({ ...base, host: base.apiHost });
  const keys = props.map((p) => `${p.siid}.${p.piid}`).join(',');
  const signal = opts.signal ?? base.signal;
  const timeoutMs = opts.timeoutMs ?? base.timeoutMs;

  const raw = await httpPostJsonBody<BaseResponse>({
    ctx,
    path: '/dreame-user-iot/iotstatus/props',
    accessToken: base.session.accessToken,
    body: { did: base.did, keys },
    context: 'cached properties',
    ...(signal !== undefined ? { signal } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });

  const parsed = CachedPropsResponseSchema.parse(raw);
  // The HTTP layer already rejects code !== 0; this is a defensive backstop so
  // the contract (code === 0 ⇒ success) holds even if that check is bypassed.
  if (parsed.code !== undefined && parsed.code !== 0) {
    throw new DreameApiError(
      `cached properties rejected: code=${parsed.code} msg=${parsed.msg ?? '?'}`,
      200,
      parsed,
    );
  }
  return (parsed.data ?? []).flatMap((entry) => {
    const [siidStr, piidStr] = entry.key.split('.');
    const siid = Number(siidStr);
    const piid = Number(piidStr);
    if (!Number.isFinite(siid) || !Number.isFinite(piid)) {
      return [];
    }
    const result: PropertyResult = { siid, piid, value: coerceShadowValue(entry.value) };
    if (entry.updateDate !== undefined) {
      result.updateDate = entry.updateDate;
    }
    return [result];
  });
}

/**
 * Coerce a cloud-shadow value (delivered as a string) back to the type the
 * typed getters expect: a numeric string → number, `"true"`/`"false"` →
 * boolean, anything else (incl. already-typed values) is returned unchanged.
 */
function coerceShadowValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  // Number('') === 0 and Number('1,2') === NaN — only coerce a clean numeric
  // token, leaving fault-list strings like "18,107" intact.
  if (value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return value;
}

/** Write one or more MIoT properties to a device. */
export async function setProperties(
  base: CommonInput,
  writes: PropertyWrite[],
  opts: CallOptions = {},
): Promise<PropertyResult[]> {
  const params = writes.map((p) => ({
    did: base.did,
    siid: p.siid,
    piid: p.piid,
    value: p.value,
  }));
  const res = await sendCommand({ ...base, ...opts, method: 'set_properties', params });
  return extractResultArray(res, 'set_properties');
}

/**
 * Invoke a single MIoT action. Unlike property calls, `params` is a single
 * OBJECT, not an array — an array here surfaces as a misleading code 80001.
 */
export async function callAction(
  base: CommonInput,
  action: MiotAction,
  opts: CallOptions = {},
): Promise<unknown> {
  const params = {
    did: base.did,
    siid: action.siid,
    aiid: action.aiid,
    in: action.in ?? [],
  };
  const res = await sendCommand({ ...base, ...opts, method: 'action', params });
  return res.data?.result ?? res.result ?? res;
}

/**
 * Fetch batched device data (the mower's vector map: `MAP.*` / `M_PATH.*` chunk
 * keys, plus `SETTINGS.*` / `SCHEDULE.*` / `OTA_INFO.*` groups) for a set of
 * property groups.
 *
 * Hits `dreame-user-iot/iotuserdata/getDeviceData` — the SAME account-auth host
 * as {@link getCachedProperties} (NOT the `device/sendCommand` envelope), so it
 * resolves the cloud-stored data for a standby/sleeping robot. Body is
 * `{ did, model: props }` where `model` (the firmware's spelling) carries the
 * requested key groups (e.g. `['MAP','M_PATH']`); an empty list returns every
 * group. The response `data` is a flat dict of `KEY.idx` chunk values that
 * {@link import('../models/mower/map/parser.js').parseBatchMapData} reassembles.
 *
 * Endpoint recovered from the Tasshack `dreame-vacuum` protocol table
 * (`_strings[23]/[26]/[44]` = `dreame-user-iot/iotuserdata/getDeviceData`) and
 * the donor `antondaubert/dreame-mower` device-data analysis tool.
 */
export async function getBatchDeviceDatas(
  base: CommonInput,
  props: string[],
  opts: CallOptions = {},
): Promise<Record<string, unknown>> {
  const ctx = base.ctx ?? RequestContext.from({ ...base, host: base.apiHost });
  const signal = opts.signal ?? base.signal;
  const timeoutMs = opts.timeoutMs ?? base.timeoutMs;

  const raw = await httpPostJsonBody<BaseResponse>({
    ctx,
    path: '/dreame-user-iot/iotuserdata/getDeviceData',
    accessToken: base.session.accessToken,
    body: { did: base.did, model: props },
    context: 'batch device data',
    ...(signal !== undefined ? { signal } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });

  const parsed = BatchDeviceDataResponseSchema.parse(raw);
  // The HTTP layer already rejects code !== 0; this is a defensive backstop so
  // the contract (code === 0 ⇒ success) holds even if that check is bypassed.
  if (parsed.code !== undefined && parsed.code !== 0) {
    throw new DreameApiError(
      `batch device data rejected: code=${parsed.code} msg=${parsed.msg ?? '?'}`,
      200,
      parsed,
    );
  }
  return parsed.data ?? {};
}

function extractResultArray(res: SendCommandResponse, context: string): PropertyResult[] {
  const raw = Array.isArray(res.data?.result)
    ? res.data.result
    : Array.isArray(res.result)
      ? res.result
      : null;
  if (raw === null) {
    throw new DreameApiError(
      `${context}: response did not contain a result array — ${JSON.stringify(res).slice(0, 200)}`,
      200,
      res,
    );
  }
  // Validate STRUCTURE leniently (array of objects, known fields optional)
  // rather than casting unknown[] straight to PropertyResult[].
  const parsed = z.array(PropertyResultSchema).safeParse(raw);
  if (!parsed.success) {
    throw new DreameApiError(
      `${context}: result array contained a non-object element — ${JSON.stringify(raw).slice(0, 200)}`,
      200,
      res,
    );
  }
  return parsed.data;
}
