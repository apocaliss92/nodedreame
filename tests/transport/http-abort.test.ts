import { describe, it, expect, vi } from 'vitest';
import { RequestContext, httpPostJson } from '../../src/transport/http.js';
import type { FetchImpl } from '../../src/transport/fetch.js';
import { DreameApiError, DreameTransportError } from '../../src/transport/errors.js';

/** Build a minimal Response with a given body text and HTTP status. */
const textResponse = (body: string, status = 200): Response => new Response(body, { status });

/** Build a Response with no body (empty string) and a given status. */
const emptyResponse = (status = 200): Response => new Response('', { status });

describe('httpPostJson — abort and timeout branches', () => {
  it('wraps an AbortError rejection as DreameTransportError (abort/timeout path)', async () => {
    const abortErr = new DOMException('The operation was aborted.', 'AbortError');
    const fetchImpl = vi.fn<FetchImpl>(async () => {
      throw abortErr;
    });
    const ctx = RequestContext.from({ region: 'eu', fetchImpl });

    const err = await httpPostJson({
      ctx,
      url: ctx.url('/p'),
      headers: {},
      body: '',
      context: 'abort-test',
      timeoutMs: 5000,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DreameTransportError);
    expect((err as DreameTransportError).message).toMatch(/aborted after 5000ms or by caller/);
    expect((err as DreameTransportError).cause).toBe(abortErr);
  });

  it('wraps a TimeoutError rejection as DreameTransportError', async () => {
    const timeoutErr = Object.assign(new Error('The operation timed out.'), {
      name: 'TimeoutError',
    });
    const fetchImpl = vi.fn<FetchImpl>(async () => {
      throw timeoutErr;
    });
    const ctx = RequestContext.from({ region: 'eu', fetchImpl });

    const err = await httpPostJson({
      ctx,
      url: ctx.url('/p'),
      headers: {},
      body: '',
      context: 'timeout-test',
      timeoutMs: 1000,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DreameTransportError);
    expect((err as DreameTransportError).message).toMatch(/aborted after 1000ms or by caller/);
  });

  it('passes a composed signal (caller AbortSignal + timeout) to fetch', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async (_url, init) => {
      // The composed signal must be an AbortSignal instance
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify({ code: 0 }), { status: 200 });
    });
    const ctx = RequestContext.from({ region: 'eu', fetchImpl });
    const controller = new AbortController();

    await httpPostJson({
      ctx,
      url: ctx.url('/p'),
      headers: {},
      body: '',
      context: 'compose-test',
      timeoutMs: 30000,
      signal: controller.signal,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('aborts the request when the caller-supplied AbortController fires (composed-signal path)', async () => {
    const controller = new AbortController();
    const abortErr = new DOMException('Aborted by caller', 'AbortError');

    const fetchImpl = vi.fn<FetchImpl>(async () => {
      controller.abort();
      throw abortErr;
    });
    const ctx = RequestContext.from({ region: 'eu', fetchImpl });

    const err = await httpPostJson({
      ctx,
      url: ctx.url('/p'),
      headers: {},
      body: '',
      context: 'caller-abort',
      timeoutMs: 30000,
      signal: controller.signal,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DreameTransportError);
    expect((err as DreameTransportError).message).toMatch(/aborted after 30000ms or by caller/);
  });

  it('passes the caller signal through unmodified when timeoutMs <= 0', async () => {
    const controller = new AbortController();
    let capturedSignal: AbortSignal | null | undefined = undefined;

    const fetchImpl = vi.fn<FetchImpl>(async (_url, init) => {
      capturedSignal = init?.signal ?? null;
      return new Response(JSON.stringify({ code: 0 }), { status: 200 });
    });
    const ctx = RequestContext.from({ region: 'eu', fetchImpl });

    await httpPostJson({
      ctx,
      url: ctx.url('/p'),
      headers: {},
      body: '',
      context: 'no-timeout',
      timeoutMs: 0,
      signal: controller.signal,
    });

    // With timeoutMs <= 0 composeSignals returns the caller signal directly
    expect(capturedSignal).toBe(controller.signal);
  });

  it('passes no signal to fetch when timeoutMs <= 0 and no caller signal', async () => {
    let capturedInit: Parameters<FetchImpl>[1] | undefined;

    const fetchImpl = vi.fn<FetchImpl>(async (_url, init) => {
      capturedInit = init;
      return new Response(JSON.stringify({ code: 0 }), { status: 200 });
    });
    const ctx = RequestContext.from({ region: 'eu', fetchImpl });

    await httpPostJson({
      ctx,
      url: ctx.url('/p'),
      headers: {},
      body: '',
      context: 'no-timeout-no-signal',
      timeoutMs: -1,
    });

    // composeSignals returns undefined → no signal key in RequestInit
    expect(capturedInit).not.toHaveProperty('signal');
  });
});

describe('httpPostJson — empty-body / null-parsed branch', () => {
  it('throws DreameApiError when the 2xx response body is empty (non-JSON)', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => emptyResponse(200));
    const ctx = RequestContext.from({ region: 'eu', fetchImpl });

    const err = await httpPostJson({
      ctx,
      url: ctx.url('/p'),
      headers: {},
      body: '',
      context: 'empty-body',
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DreameApiError);
    expect((err as DreameApiError).message).toMatch(/response was not JSON/);
    expect((err as DreameApiError).status).toBe(200);
  });

  it('throws DreameApiError when the 2xx body is non-JSON text', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => textResponse('not-json', 200));
    const ctx = RequestContext.from({ region: 'eu', fetchImpl });

    const err = await httpPostJson({
      ctx,
      url: ctx.url('/p'),
      headers: {},
      body: '',
      context: 'bad-json',
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DreameApiError);
    expect((err as DreameApiError).message).toMatch(/response was not JSON/);
  });

  it('throws DreameApiError on non-2xx status even when body is present', async () => {
    // Use a parseable body so we can confirm the !res.ok branch is taken, not the !parsed branch
    const fetchImpl = vi.fn<FetchImpl>(
      async () => new Response(JSON.stringify({ code: 0 }), { status: 403 }),
    );
    const ctx = RequestContext.from({ region: 'eu', fetchImpl });

    const err = await httpPostJson({
      ctx,
      url: ctx.url('/p'),
      headers: {},
      body: '',
      context: 'non-2xx',
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DreameApiError);
    expect((err as DreameApiError).status).toBe(403);
  });
});
