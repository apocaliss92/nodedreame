import { describe, it, expect, vi } from 'vitest';
import { sendCommand, getProperties, setProperties, callAction } from '../../src/cloud/commands.js';
import { DreameApiError } from '../../src/transport/errors.js';
import type { DreameSession } from '../../src/cloud/types.js';
import type { FetchImpl } from '../../src/transport/fetch.js';

const session: DreameSession = {
  accessToken: 'TOK',
  uid: 'u',
  expiresAt: Date.now() + 1e6,
  region: 'eu',
};

const ok = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });

const captureBody = (fetchImpl: ReturnType<typeof vi.fn<FetchImpl>>): Record<string, unknown> => {
  const init = fetchImpl.mock.calls[0]![1];
  return JSON.parse(init!.body as string) as Record<string, unknown>;
};

describe('sendCommand', () => {
  it('posts to /dreame-iot-com-10000/device/sendCommand with did/id and nested data', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => ok({ code: 0, data: { result: [] } }));
    await sendCommand({
      session,
      region: 'eu',
      did: 'DID1',
      method: 'get_properties',
      params: [{ did: 'DID1', siid: 2, piid: 1 }],
      fetchImpl,
    });
    const [url] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://eu.iot.dreame.tech:13267/dreame-iot-com-10000/device/sendCommand');
    const body = captureBody(fetchImpl);
    expect(body.did).toBe('DID1');
    expect(typeof body.id).toBe('number');
    const data = body.data as Record<string, unknown>;
    expect(data.did).toBe('DID1');
    expect(data.id).toBe(body.id);
    expect(data.method).toBe('get_properties');
    expect(data.from).toBe('XXXXXX');
  });
});

describe('getProperties / setProperties (array params)', () => {
  it('wraps property descriptors as an ARRAY', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      ok({ code: 0, data: { result: [{ siid: 2, piid: 1, value: 13 }] } }),
    );
    const res = await getProperties({ session, region: 'eu', did: 'D', fetchImpl }, [
      { siid: 2, piid: 1 },
    ]);
    expect(res[0]?.value).toBe(13);
    const params = (captureBody(fetchImpl).data as Record<string, unknown>).params;
    expect(Array.isArray(params)).toBe(true);
    expect((params as unknown[])[0]).toEqual({ did: 'D', siid: 2, piid: 1 });
  });

  it('set_properties carries did/siid/piid/value per entry', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => ok({ code: 0, data: { result: [] } }));
    await setProperties({ session, region: 'eu', did: 'D', fetchImpl }, [
      { siid: 2, piid: 6, value: 1 },
    ]);
    const params = (captureBody(fetchImpl).data as Record<string, unknown>).params as unknown[];
    expect(params[0]).toEqual({ did: 'D', siid: 2, piid: 6, value: 1 });
  });
});

describe('callAction (object params — the 80001 trap)', () => {
  it('sends params as a SINGLE OBJECT, never an array', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => ok({ code: 0, data: { result: { ok: true } } }));
    await callAction({ session, region: 'eu', did: 'D', fetchImpl }, { siid: 7, aiid: 1, in: [] });
    const params = (captureBody(fetchImpl).data as Record<string, unknown>).params;
    expect(Array.isArray(params)).toBe(false);
    expect(params).toEqual({ did: 'D', siid: 7, aiid: 1, in: [] });
  });

  it('defaults in:[] when omitted', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => ok({ code: 0, data: { result: {} } }));
    await callAction({ session, region: 'eu', did: 'D', fetchImpl }, { siid: 5, aiid: 2 });
    const params = (captureBody(fetchImpl).data as Record<string, unknown>).params as Record<
      string,
      unknown
    >;
    expect(params.in).toEqual([]);
  });
});

describe('result extraction', () => {
  it('throws DreameApiError when no result array is present', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => ok({ code: 0, data: {} }));
    await expect(
      getProperties({ session, region: 'eu', did: 'D', fetchImpl }, [{ siid: 2, piid: 1 }]),
    ).rejects.toBeInstanceOf(DreameApiError);
  });

  it('throws DreameApiError when a result element is not an object', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => ok({ code: 0, data: { result: [42, 'nope'] } }));
    await expect(
      getProperties({ session, region: 'eu', did: 'D', fetchImpl }, [{ siid: 2, piid: 1 }]),
    ).rejects.toBeInstanceOf(DreameApiError);
  });

  it('leniently parses result elements with missing known fields', async () => {
    // Real cloud data we have not fully observed: an object without siid/piid
    // and with extra keys must pass through, not be rejected.
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      ok({ code: 0, data: { result: [{ value: 13, extra: 'x' }, { code: 0 }] } }),
    );
    const res = await getProperties({ session, region: 'eu', did: 'D', fetchImpl }, [
      { siid: 2, piid: 1 },
    ]);
    expect(res).toHaveLength(2);
    expect(res[0]?.value).toBe(13);
    expect(res[0]?.extra).toBe('x');
    expect(res[1]?.code).toBe(0);
  });
});
