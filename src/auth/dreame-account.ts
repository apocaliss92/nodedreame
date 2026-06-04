import type { DreameRegion } from './config.js';
import type { DreameSession } from '../cloud/types.js';
import { DreameAuthError } from '../transport/errors.js';
import { hashPassword } from '../transport/crypto.js';
import { httpPostJson, RequestContext, type BaseResponse } from '../transport/http.js';
import { OAuthTokenResponseSchema } from '../transport/schemas.js';
import type { FetchImpl } from '../transport/http.js';

export interface LoginInput {
  email: string;
  password: string;
  region: DreameRegion;
  /** ISO-3166 alpha-2. Defaults from region. */
  country?: string;
  /** ISO-639-1. Defaults from region. */
  lang?: string;
  /** Override host (advanced — for testing). */
  authHost?: string;
  /** Inject a fetch impl for testing. */
  fetchImpl?: FetchImpl;
}

export interface RefreshInput {
  refreshToken: string;
  region: DreameRegion;
  country?: string;
  lang?: string;
  authHost?: string;
  fetchImpl?: FetchImpl;
}

function ctxFromInput(input: {
  region: DreameRegion;
  country?: string;
  lang?: string;
  authHost?: string;
  fetchImpl?: FetchImpl;
}): RequestContext {
  return RequestContext.from({ ...input, host: input.authHost });
}

/** Authenticate against the Dreame native cloud (OAuth2 password grant). */
export async function login(input: LoginInput): Promise<DreameSession> {
  const ctx = ctxFromInput(input);
  const body = new URLSearchParams({
    grant_type: 'password',
    scope: 'all',
    platform: 'IOS',
    type: 'account',
    username: input.email,
    password: hashPassword(input.password),
    country: ctx.country,
    lang: ctx.lang,
  });
  return postForToken(ctx, body);
}

/** Exchange a refresh token for a fresh access token. Refresh ~100s before expiry. */
export async function refresh(input: RefreshInput): Promise<DreameSession> {
  const ctx = ctxFromInput(input);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
  });
  return postForToken(ctx, body);
}

async function postForToken(ctx: RequestContext, body: URLSearchParams): Promise<DreameSession> {
  // The OAuth response is validated/narrowed by `OAuthTokenResponseSchema.parse`
  // below; the HTTP layer only needs the minimal `BaseResponse` shape here. The
  // zod-inferred `OAuthTokenResponse` cannot be the generic directly because its
  // passthrough widening makes `code` `number | undefined`, which is
  // incompatible with `BaseResponse.code?: number` under exactOptionalPropertyTypes.
  const raw = await httpPostJson<BaseResponse>({
    ctx,
    url: ctx.url('/dreame-auth/oauth/token'),
    headers: ctx.headers(),
    body,
    context: 'auth',
    errorClass: DreameAuthError,
    skipCodeCheck: true, // OAuth uses HTTP status + top-level error fields, not parsed.code
  });

  const data = OAuthTokenResponseSchema.parse(raw);

  if (data.error || data.error_description) {
    throw new DreameAuthError(
      `auth failed: ${data.error ?? '?'} — ${data.error_description ?? 'no description'}`,
    );
  }
  if (!data.access_token) {
    throw new DreameAuthError(
      `auth response missing access_token: ${JSON.stringify(data).slice(0, 200)}`,
    );
  }

  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 7200;
  const uid = data.uid !== undefined ? String(data.uid) : '';
  if (!uid) {
    throw new DreameAuthError('auth response missing uid');
  }

  const session: DreameSession = {
    accessToken: data.access_token,
    uid,
    expiresAt: Date.now() + expiresIn * 1000,
    region: ctx.region,
  };
  if (typeof data.refresh_token === 'string') {
    session.refreshToken = data.refresh_token;
  }
  return session;
}
