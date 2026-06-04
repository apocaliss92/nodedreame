import { describe, it, expect, vi } from 'vitest';
import { RequestContext, httpPostJson, httpPostJsonBody } from '../../src/transport/http.js';
import type { FetchImpl } from '../../src/transport/fetch.js';
import {
  DreameApiError,
  DreameAuthError,
  DreameDeviceOfflineError,
  DreameTransportError,
} from '../../src/transport/errors.js';

const okResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

describe('RequestContext', () => {
  it('resolves region defaults and builds urls/headers', () => {
    const ctx = RequestContext.from({ region: 'eu' });
    expect(ctx.country).toBe('GB');
    expect(ctx.lang).toBe('en');
    expect(ctx.host).toBe('eu.iot.dreame.tech:13267');
    expect(ctx.url('/x')).toBe('https://eu.iot.dreame.tech:13267/x');
    expect(ctx.headers().authorization).toMatch(/^Basic /);
  });

  it('honours overrides and strips undefined fields', () => {
    const ctx = RequestContext.from({ region: 'eu', country: 'IT', host: 'h:1' });
    expect(ctx.country).toBe('IT');
    expect(ctx.host).toBe('h:1');
  });
});

describe('httpPostJson', () => {
  it('returns parsed body on code 0', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => okResponse({ code: 0, data: { ok: true } }));
    const ctx = RequestContext.from({ region: 'eu', fetchImpl });
    const res = await httpPostJson<{ code?: number; data?: { ok?: boolean } }>({
      ctx,
      url: ctx.url('/p'),
      headers: ctx.headers(),
      body: 'x=1',
      context: 'test',
    });
    expect(res.data?.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('x=1');
  });

  it('throws DreameDeviceOfflineError on code 80001', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => okResponse({ code: 80001, msg: 'timeout' }));
    const ctx = RequestContext.from({ region: 'eu', fetchImpl });
    await expect(
      httpPostJson({ ctx, url: ctx.url('/p'), headers: {}, body: '', context: 'cmd' }),
    ).rejects.toBeInstanceOf(DreameDeviceOfflineError);
  });

  it('throws the supplied error class on a non-zero, non-80001 code', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => okResponse({ code: 7, msg: 'bad' }));
    const ctx = RequestContext.from({ region: 'eu', fetchImpl });
    await expect(
      httpPostJson({
        ctx,
        url: ctx.url('/p'),
        headers: {},
        body: '',
        context: 'auth',
        errorClass: DreameAuthError,
      }),
    ).rejects.toBeInstanceOf(DreameAuthError);
  });

  it('skips the code check when skipCodeCheck is set (OAuth)', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => okResponse({ access_token: 'a', uid: 'u' }));
    const ctx = RequestContext.from({ region: 'eu', fetchImpl });
    const res = await httpPostJson<{ access_token?: string; code?: number; msg?: string }>({
      ctx,
      url: ctx.url('/dreame-auth/oauth/token'),
      headers: {},
      body: '',
      context: 'auth',
      skipCodeCheck: true,
    });
    expect(res.access_token).toBe('a');
  });

  it('throws DreameApiError on non-2xx HTTP status', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => okResponse({ msg: 'no' }, 500));
    const ctx = RequestContext.from({ region: 'eu', fetchImpl });
    await expect(
      httpPostJson({ ctx, url: ctx.url('/p'), headers: {}, body: '', context: 'x' }),
    ).rejects.toBeInstanceOf(DreameApiError);
  });

  it('wraps network failure as DreameTransportError', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => {
      throw new Error('ECONNREFUSED');
    });
    const ctx = RequestContext.from({ region: 'eu', fetchImpl });
    await expect(
      httpPostJson({ ctx, url: ctx.url('/p'), headers: {}, body: '', context: 'x' }),
    ).rejects.toBeInstanceOf(DreameTransportError);
  });
});

describe('httpPostJsonBody', () => {
  it('stringifies the body and sets JSON content-type', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => okResponse({ code: 0 }));
    const ctx = RequestContext.from({ region: 'eu', fetchImpl });
    await httpPostJsonBody({
      ctx,
      path: '/dreame-user-iot/iotuserbind/device/listV2',
      accessToken: 'TOK',
      body: { current: 1 },
      context: 'device list',
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://eu.iot.dreame.tech:13267/dreame-user-iot/iotuserbind/device/listV2');
    expect(init?.body).toBe(JSON.stringify({ current: 1 }));
    const headers = init?.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers['dreame-auth']).toBe('bearer TOK');
  });
});
