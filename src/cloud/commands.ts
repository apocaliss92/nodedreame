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
 * Fetch batched device data (the mower's vector map: `MAP.*` / `M_PATH.*`
 * chunk keys) for a set of property groups.
 *
 * ⚠️ ENDPOINT GAP — LIVE PATH UNRECOVERED. The concrete batch-fetch endpoint
 * path is OBFUSCATED in the donor (`antondaubert/dreame-mower` builds it from
 * an encoded `_api_strings` table — entries `[23]/[26]/[44]` — that we have not
 * decoded). The donor's `cloud_base` resolves to a `/dreame-iot-com-<prefix>/…`
 * route we cannot reproduce byte-exact without that table, and we will NOT
 * invent a wrong URL. Recovering the real path is a documented follow-up; until
 * then this function will THROW if invoked against the live cloud.
 *
 * The map PARSER (`parseBatchMapData`) is the shipped deliverable and is fully
 * unit-tested with synthetic batch fixtures. `MowerDevice.getMap` consumes an
 * INJECTED {@link BatchDeviceDataFetcher} seam, so tests (and any caller that
 * already knows the path) drive it with no dependency on this stub.
 *
 * @throws DreameApiError always — the endpoint path is not yet recovered.
 */
export async function getBatchDeviceDatas(
  base: CommonInput,
  props: string[],
): Promise<Record<string, unknown>> {
  // Deliberately unreachable in production until the endpoint is recovered. The
  // request is described in the error so the gap is self-documenting at runtime.
  return Promise.reject(
    new DreameApiError(
      `getBatchDeviceDatas(did=${base.did}, props=${JSON.stringify(props)}): live ` +
        'batch-fetch endpoint path is not yet recovered (obfuscated in the donor). ' +
        'Inject a BatchDeviceDataFetcher into MowerDevice instead, or supply the ' +
        'resolved path once known.',
      0,
    ),
  );
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
