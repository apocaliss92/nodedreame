import type { DreameRegion } from '../auth/config.js';
import type { DreameCloudState, DreameDevice, DreameSession } from './types.js';
import {
  httpPostJsonBody,
  RequestContext,
  type BaseResponse,
  type FetchImpl,
} from '../transport/http.js';
import { DeviceListResponseSchema, type RawDevice } from '../transport/schemas.js';

export interface ListDevicesInput {
  session: DreameSession;
  region: DreameRegion;
  ctx?: RequestContext;
  country?: string;
  lang?: string;
  apiHost?: string;
  fetchImpl?: FetchImpl;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Enumerate the devices visible to the authenticated account (incl. shared). */
export async function listDevices(input: ListDevicesInput): Promise<DreameDevice[]> {
  const ctx = input.ctx ?? RequestContext.from({ ...input, host: input.apiHost });

  // The response is validated/narrowed by `DeviceListResponseSchema.parse`
  // below; the HTTP layer only needs the minimal `BaseResponse` shape. The
  // zod-inferred `DeviceListResponse` cannot be the generic directly because
  // its passthrough widening makes `code` `number | undefined`, which is
  // incompatible with `BaseResponse.code?: number` under exactOptionalPropertyTypes.
  const raw = await httpPostJsonBody<BaseResponse>({
    ctx,
    path: '/dreame-user-iot/iotuserbind/device/listV2',
    accessToken: input.session.accessToken,
    body: {
      sharedStatus: 1,
      current: 1,
      size: 100,
      lang: ctx.lang,
      timestamp: Date.now(),
    },
    context: 'device list',
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
  });

  const parsed = DeviceListResponseSchema.parse(raw);
  const records = parsed.data?.page?.records ?? parsed.data?.records ?? parsed.records ?? [];
  return records.map(toDevice);
}

function toDevice(rawIn: RawDevice): DreameDevice {
  const raw = rawIn as Record<string, unknown>;
  const did = String(rawIn.did ?? '');
  const model = String(rawIn.model ?? '');
  const name = String(rawIn.customName || rawIn.deviceName || model || did);

  let lwtFlag = 0;
  if (typeof raw['property'] === 'string') {
    try {
      const p = JSON.parse(raw['property']) as { lwt?: number };
      if (p && typeof p.lwt === 'number') {
        lwtFlag = p.lwt;
      }
    } catch {
      // ignore malformed JSON
    }
  }
  const online = rawIn.online === true || rawIn.lwt === 1 || lwtFlag === 1;

  const device: DreameDevice = {
    did,
    model,
    name,
    online,
    raw,
    cloudState: parseCloudState(raw),
  };
  if (rawIn.mac) {
    device.mac = String(rawIn.mac);
  }
  if (typeof raw['ver'] === 'string') {
    device.firmwareVersion = raw['ver'];
  }
  if (typeof raw['sn'] === 'string') {
    device.serialNumber = raw['sn'];
  }
  return device;
}

function parseCloudState(raw: Record<string, unknown>): DreameCloudState {
  const latestStatus = typeof raw['latestStatus'] === 'number' ? raw['latestStatus'] : null;
  const battery = typeof raw['battery'] === 'number' ? raw['battery'] : null;
  const featureCode2 = typeof raw['featureCode2'] === 'number' ? raw['featureCode2'] : null;
  let videoActive: boolean | null = null;
  if (typeof raw['videoStatus'] === 'string') {
    try {
      const v = JSON.parse(raw['videoStatus']) as { operType?: string; status?: number };
      if (v?.operType === 'end' || v?.status === 0) {
        videoActive = false;
      } else if (v?.operType || v?.status) {
        videoActive = true;
      }
    } catch {
      // ignore malformed JSON
    }
  }
  return { latestStatus, battery, videoActive, featureCode2 };
}
