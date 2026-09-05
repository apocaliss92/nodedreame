import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { defaultFetch, type FetchImpl } from '../../transport/fetch.js';
import { DreameApiError } from '../../transport/errors.js';
import { ALIYUN_APP_KEY, ALIYUN_APP_SECRET, apiIotHost, livingAccountHost } from './constants.js';
import { signApiGatewayRequest } from './signing.js';

/** Aliyun OpenAccount session from loginbyoauth. */
export interface OaSession {
  sid: string;
  refreshToken: string;
  openId: string;
}

/** Aliyun IoT session (the iotToken used by every LinkVisual call). */
export interface IotSession {
  iotToken: string;
  refreshToken: string;
  identityId: string;
  /** Epoch-ms at which iotToken expires. */
  expiresAt: number;
}

const LoginByOauthSchema = z
  .object({
    data: z
      .object({
        data: z
          .object({
            loginSuccessResult: z
              .object({
                sid: z.string(),
                refreshToken: z.string().optional(),
                token: z.string().optional(),
                openAccount: z.object({ openId: z.string().optional() }).passthrough().optional(),
              })
              .passthrough(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

const CreateSessionSchema = z
  .object({
    code: z.number().optional(),
    message: z.string().nullish(),
    data: z
      .object({
        iotToken: z.string(),
        refreshToken: z.string().optional(),
        identityId: z.string().optional(),
        iotTokenExpire: z.number().optional(),
      })
      .passthrough(),
  })
  .passthrough();

async function postJson(url: string, headers: Record<string, string>, body: string, fetchImpl: FetchImpl, ctx: string): Promise<unknown> {
  const res = await fetchImpl(url, { method: 'POST', headers, body });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new DreameApiError(`${ctx} returned non-JSON (status ${res.status})`, res.status);
  }
}

export interface LoginByOauthInput {
  authCode: string;
  regionId: string;
  deviceId?: string;
  utdid?: string;
  fetchImpl?: FetchImpl;
}

/** Exchange the Dreame authCode for an Aliyun OpenAccount session (step 2). */
export async function loginByOauth(input: LoginByOauthInput): Promise<OaSession> {
  const host = livingAccountHost(input.regionId);
  const riskControlInfo = {
    createIfNotExist: 'true', sdkVersion: '3.4.0.27', openaccountVersion: '3.4.0.27',
    platformName: 'iOS', netType: 'wifi', brand: 'Apple', USE_H5_NC: 'true',
    deviceId: input.deviceId ?? randomUUID(), locale: 'en-US', platformVersion: '26.5.2',
    platform: 'iPhone', appKey: ALIYUN_APP_KEY, USE_OA_PWD_ENCRYPT: 'true',
    model: 'iPhone16,2', utdid: input.utdid ?? randomUUID().replace(/-/g, '').slice(0, 20),
    appVersion: '1895',
  };
  const value = JSON.stringify({
    riskControlInfo, oauthPlateform: 23, oauthAppKey: ALIYUN_APP_KEY, authCode: input.authCode,
  });
  const signed = signApiGatewayRequest({
    method: 'POST', host, path: '/api/prd/loginbyoauth.json',
    appKey: ALIYUN_APP_KEY, appSecret: ALIYUN_APP_SECRET,
    form: { loginByOauthRequest: value },
  });
  const json = await postJson(`https://${host}/api/prd/loginbyoauth.json`, signed.headers, signed.body,
    input.fetchImpl ?? defaultFetch, 'loginbyoauth');
  const r = LoginByOauthSchema.parse(json).data.data.loginSuccessResult;
  return {
    sid: r.sid,
    refreshToken: r.refreshToken ?? '',
    openId: r.openAccount?.openId ?? '',
  };
}

export interface CreateIotSessionInput {
  /** The OpenAccount `sid` from {@link loginByOauth}. */
  sid: string;
  regionId: string;
  fetchImpl?: FetchImpl;
}

/** Exchange the OA `sid` for an Aliyun IoT session / iotToken (step 3). */
export async function createIotSession(input: CreateIotSessionInput): Promise<IotSession> {
  const host = apiIotHost(input.regionId);
  const path = '/account/createSessionByAuthCode';
  const payload = {
    id: randomUUID().toUpperCase(),
    params: { request: { appKey: ALIYUN_APP_KEY, authCode: input.sid, accountType: 'OA_SESSION' } },
    request: { apiVer: '1.0.4', language: 'en-US', appKey: ALIYUN_APP_KEY },
    version: '1.0.0',
  };
  const signed = signApiGatewayRequest({
    method: 'POST', host, path, appKey: ALIYUN_APP_KEY, appSecret: ALIYUN_APP_SECRET,
    json: payload, extraCaHeaders: { 'X-Ca-Stage': 'RELEASE' },
  });
  const json = await postJson(`https://${host}${path}`, signed.headers, signed.body,
    input.fetchImpl ?? defaultFetch, 'createSessionByAuthCode');
  const parsed = CreateSessionSchema.parse(json);
  if (parsed.code !== 200 && parsed.code !== 0) {
    throw new DreameApiError(`createSession rejected: code=${parsed.code} msg=${parsed.message ?? '?'}`, 200, parsed);
  }
  const d = parsed.data;
  return {
    iotToken: d.iotToken,
    refreshToken: d.refreshToken ?? '',
    identityId: d.identityId ?? '',
    expiresAt: Date.now() + (d.iotTokenExpire ?? 72000) * 1000,
  };
}
