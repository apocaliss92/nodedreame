import type { DreameRegion } from '../auth/config.js';
import {
  CONTENT_TYPE_JSON,
  REGION_DEFAULT_COUNTRY,
  REGION_DEFAULT_LANG,
  REGION_HOSTS,
} from '../auth/config.js';
import { buildHeaders } from './headers.js';
import { defaultFetch, type FetchImpl } from './fetch.js';
import {
  DreameApiError,
  DreameAuthError,
  DreameDeviceOfflineError,
  DreameTransportError,
} from './errors.js';

/** Re-export so other modules can import FetchImpl from a single location. */
export type { FetchImpl };

/** Cloud response code meaning "device didn't ACK; may be offline" (often a false negative). */
const CODE_DEVICE_OFFLINE = 80001;

/** Default per-request timeout — fetch() is otherwise unbounded. */
const DEFAULT_TIMEOUT_MS = 30000;

export interface RequestContextOpts {
  region: DreameRegion;
  country?: string;
  lang?: string;
  host?: string;
  fetchImpl?: FetchImpl;
}

export interface RequestContextInput {
  region: DreameRegion;
  country?: string | undefined;
  lang?: string | undefined;
  /** Override host. Some callers spell this `authHost`/`apiHost` — pass that here. */
  host?: string | undefined;
  fetchImpl?: FetchImpl | undefined;
}

export class RequestContext {
  readonly region: DreameRegion;
  readonly country: string;
  readonly lang: string;
  readonly host: string;
  readonly fetchImpl: FetchImpl;

  constructor(opts: RequestContextOpts) {
    this.region = opts.region;
    this.country = opts.country ?? REGION_DEFAULT_COUNTRY[opts.region];
    this.lang = opts.lang ?? REGION_DEFAULT_LANG[opts.region];
    this.host = opts.host ?? REGION_HOSTS[opts.region];
    this.fetchImpl = opts.fetchImpl ?? defaultFetch;
  }

  static from(input: RequestContextInput): RequestContext {
    return new RequestContext({
      region: input.region,
      ...(input.country !== undefined ? { country: input.country } : {}),
      ...(input.lang !== undefined ? { lang: input.lang } : {}),
      ...(input.host !== undefined ? { host: input.host } : {}),
      ...(input.fetchImpl !== undefined ? { fetchImpl: input.fetchImpl } : {}),
    });
  }

  /** `https://<host><path>` — pass a path with a leading slash. */
  url(path: string): string {
    return `https://${this.host}${path}`;
  }

  /** Build the static Dreame headers, optionally with a bearer token + content-type. */
  headers(
    opts: { accessToken?: string | null; contentType?: string } = {},
  ): Record<string, string> {
    return buildHeaders({
      region: this.region,
      country: this.country,
      lang: this.lang,
      ...(opts.accessToken !== undefined ? { accessToken: opts.accessToken } : {}),
      ...(opts.contentType !== undefined ? { contentType: opts.contentType } : {}),
    });
  }
}

/** Minimal common shape every Dreame JSON response carries. */
export interface BaseResponse {
  code?: number;
  msg?: string;
}

export async function httpPostJson<T extends BaseResponse>(input: {
  ctx: RequestContext;
  url: string;
  headers: Record<string, string>;
  body: string | URLSearchParams;
  context: string;
  errorClass?: typeof DreameApiError | typeof DreameAuthError;
  skipCodeCheck?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<T> {
  const Err = input.errorClass ?? DreameApiError;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const signal = composeSignals(input.signal, timeoutMs);

  let res: Response;
  try {
    res = await input.ctx.fetchImpl(input.url, {
      method: 'POST',
      headers: input.headers,
      body: input.body,
      ...(signal !== undefined ? { signal } : {}),
    });
  } catch (err) {
    if (isAbortError(err)) {
      throw new DreameTransportError(
        `request to ${input.url} aborted after ${timeoutMs}ms or by caller`,
        err,
      );
    }
    throw new DreameTransportError(`network error contacting ${input.url}`, err);
  }

  const text = await res.text();
  let parsed: T | null = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as T;
    } catch {
      // leave parsed null
    }
  }

  if (!res.ok) {
    throw new Err(
      `${input.context} failed: ${res.status} ${text.slice(0, 200)}`,
      res.status,
      parsed,
    );
  }
  if (!parsed) {
    throw new Err(`${input.context} response was not JSON (status ${res.status})`, res.status);
  }

  if (!input.skipCodeCheck && parsed.code !== undefined && parsed.code !== 0) {
    if (parsed.code === CODE_DEVICE_OFFLINE) {
      throw new DreameDeviceOfflineError(
        `device offline: ${parsed.msg ?? 'timeout'}`,
        res.status,
        parsed,
      );
    }
    throw new Err(
      `${input.context} rejected: code=${parsed.code} msg=${parsed.msg ?? '?'}`,
      res.status,
      parsed,
    );
  }

  return parsed;
}

export async function httpPostJsonBody<T extends BaseResponse>(input: {
  ctx: RequestContext;
  path: string;
  accessToken?: string;
  body: unknown;
  context: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<T> {
  return httpPostJson<T>({
    ctx: input.ctx,
    url: input.ctx.url(input.path),
    headers: input.ctx.headers({
      ...(input.accessToken !== undefined ? { accessToken: input.accessToken } : {}),
      contentType: CONTENT_TYPE_JSON,
    }),
    body: JSON.stringify(input.body),
    context: input.context,
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
  });
}

function composeSignals(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal | undefined {
  if (timeoutMs <= 0) {
    return callerSignal;
  }
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!callerSignal) {
    return timeoutSignal;
  }
  return AbortSignal.any([callerSignal, timeoutSignal]);
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}
