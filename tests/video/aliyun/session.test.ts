import { describe, it, expect, vi } from 'vitest';
import type { FetchImpl } from '../../../src/transport/fetch.js';
import type { DreameSession } from '../../../src/cloud/types.js';
import { DreameVideoSession } from '../../../src/video/aliyun/session.js';

const session: DreameSession = {
  accessToken: 'ACCESS',
  uid: 'u1',
  expiresAt: Date.now() + 3_600_000,
  region: 'eu',
};

const ok = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });

/** Route a mocked fetch by URL across the whole auth+stream chain. */
function makeFetch(): FetchImpl {
  return vi.fn<FetchImpl>(async (url) => {
    const u = String(url);
    if (u.includes('getAuthCodeV3')) return ok({ code: 0, data: 'a'.repeat(2144) });
    if (u.includes('loginbyoauth')) {
      return ok({ data: { data: { loginSuccessResult: { sid: 'SID123456', refreshToken: 'RT', openAccount: { openId: 'oid' } } } } });
    }
    if (u.includes('createSessionByAuthCode')) {
      return ok({ code: 200, data: { iotToken: 'IOTTOKEN', refreshToken: 'RT2', identityId: 'idn', iotTokenExpire: 72000 } });
    }
    if (u.includes('stream/query')) {
      return ok({ code: 200, data: { typeList: ['Relay'], relayUrl: 'rtmp://relay/live?token=z/K_0', relayDecryptKey: {} } });
    }
    throw new Error('unexpected url ' + u);
  });
}

describe('DreameVideoSession', () => {
  it('runs the full chain once, caches the iotToken, and mints RTMP URLs', async () => {
    const fetchImpl = makeFetch();
    const vs = new DreameVideoSession({ session, region: 'eu', fetchImpl });
    expect(vs.regionId).toBe('eu-central-1');

    const url1 = await vs.getRtmpUrl('IOT_A');
    expect(url1).toBe('rtmp://relay/live?token=z/K_0');

    const url2 = await vs.getRtmpUrl('IOT_A');
    expect(url2).toBe('rtmp://relay/live?token=z/K_0');

    // The auth chain (authCode + loginbyoauth + createSession) must run only ONCE;
    // only stream/query repeats per mint.
    const calls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
    expect(calls.filter((u) => u.includes('createSessionByAuthCode'))).toHaveLength(1);
    expect(calls.filter((u) => u.includes('loginbyoauth'))).toHaveLength(1);
    expect(calls.filter((u) => u.includes('stream/query'))).toHaveLength(2);
  });

  it('getStreamInfo exposes relay + p2p info', async () => {
    const vs = new DreameVideoSession({ session, region: 'eu', fetchImpl: makeFetch() });
    const info = await vs.getStreamInfo('IOT_A');
    expect(info.relayUrl).toContain('rtmp://');
    expect(info.relayDecryptKey).toBeNull();
  });

  it('retries stream/query while the device is offline (waking), then returns the relay', async () => {
    let sq = 0;
    const fetchImpl = vi.fn<FetchImpl>(async (url) => {
      const u = String(url);
      if (u.includes('getAuthCodeV3')) return ok({ code: 0, data: 'a'.repeat(2144) });
      if (u.includes('loginbyoauth')) return ok({ data: { data: { loginSuccessResult: { sid: 'S', refreshToken: 'R', openAccount: { openId: 'o' } } } } });
      if (u.includes('createSessionByAuthCode')) return ok({ code: 200, data: { iotToken: 'IT', iotTokenExpire: 72000 } });
      if (u.includes('stream/query')) {
        sq += 1;
        return sq < 3
          ? ok({ code: 9201, message: 'device offline' })
          : ok({ code: 200, data: { relayUrl: 'rtmp://relay/live/K_0', relayDecryptKey: {} } });
      }
      throw new Error('unexpected ' + u);
    });
    const vs = new DreameVideoSession({ session, region: 'eu', fetchImpl });
    const info = await vs.getStreamInfo('IOT_A', { wakeTimeoutMs: 10_000, pollMs: 1 });
    expect(info.relayUrl).toContain('rtmp://');
    expect(sq).toBe(3); // two offline responses, then success
  });

  it('fails fast on offline when wakeTimeoutMs is 0', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async (url) => {
      const u = String(url);
      if (u.includes('getAuthCodeV3')) return ok({ code: 0, data: 'a'.repeat(2144) });
      if (u.includes('loginbyoauth')) return ok({ data: { data: { loginSuccessResult: { sid: 'S', openAccount: {} } } } });
      if (u.includes('createSessionByAuthCode')) return ok({ code: 200, data: { iotToken: 'IT', iotTokenExpire: 72000 } });
      return ok({ code: 9201, message: 'device offline' });
    });
    const vs = new DreameVideoSession({ session, region: 'eu', fetchImpl });
    await expect(vs.getStreamInfo('IOT_A', { wakeTimeoutMs: 0 })).rejects.toThrow(/offline/);
  });
});
