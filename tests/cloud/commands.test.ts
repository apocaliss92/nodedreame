import { describe, it, expect, vi } from 'vitest';
import {
  sendCommand,
  getProperties,
  getCachedProperties,
  setProperties,
  callAction,
  getBatchDeviceDatas,
} from '../../src/cloud/commands.js';
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

describe('getCachedProperties (cloud shadow / iotstatus/props)', () => {
  it('POSTs to /dreame-user-iot/iotstatus/props with {did, keys} as a COMMA STRING', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      ok({ code: 0, msg: '操作成功', data: [{ key: '2.1', value: '13', updateDate: 1 }] }),
    );
    await getCachedProperties({ session, region: 'eu', did: 'DID7', fetchImpl }, [
      { siid: 2, piid: 1 },
      { siid: 3, piid: 1 },
      { siid: 3, piid: 2 },
    ]);
    const [url] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://eu.iot.dreame.tech:13267/dreame-user-iot/iotstatus/props');
    const body = captureBody(fetchImpl);
    expect(body.did).toBe('DID7');
    // keys MUST be the comma-joined STRING (array → 10001; empty → 10007).
    expect(body.keys).toBe('2.1,3.1,3.2');
    expect(typeof body.keys).toBe('string');
  });

  it('parses data[] into PropertyResult[], coercing string values to number/boolean', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      ok({
        code: 0,
        data: [
          { key: '3.1', value: '100', updateDate: 1780664532160 },
          { key: '2.2', value: 'true' },
          { key: '4.18', value: '18,107' },
        ],
      }),
    );
    const res = await getCachedProperties({ session, region: 'eu', did: 'D', fetchImpl }, [
      { siid: 3, piid: 1 },
    ]);
    expect(res[0]).toMatchObject({ siid: 3, piid: 1, value: 100 });
    // updateDate is surfaced for cache-age reporting.
    expect(res[0]?.updateDate).toBe(1780664532160);
    expect(res[1]).toMatchObject({ siid: 2, piid: 2, value: true });
    // non-numeric, non-boolean string stays a string (e.g. fault list).
    expect(res[2]).toMatchObject({ siid: 4, piid: 18, value: '18,107' });
  });

  it('throws DreameApiError when code !== 0 (never 80001 for idle devices)', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => ok({ code: 10001, msg: 'bad keys' }));
    await expect(
      getCachedProperties({ session, region: 'eu', did: 'D', fetchImpl }, [{ siid: 2, piid: 1 }]),
    ).rejects.toBeInstanceOf(DreameApiError);
  });
});

describe('getBatchDeviceDatas (iotuserdata/getDeviceData)', () => {
  it('POSTs to /dreame-user-iot/iotuserdata/getDeviceData with {did, model: props}', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      ok({ code: 0, data: { 'MAP.0': 'AAA', 'MAP.info': '{}' } }),
    );
    await getBatchDeviceDatas({ session, region: 'eu', did: 'DID9', fetchImpl }, ['MAP', 'M_PATH']);
    const [url] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://eu.iot.dreame.tech:13267/dreame-user-iot/iotuserdata/getDeviceData');
    const body = captureBody(fetchImpl);
    expect(body.did).toBe('DID9');
    // The firmware spells the requested key-group list `model`.
    expect(body.model).toEqual(['MAP', 'M_PATH']);
  });

  it('returns the flat chunk dict from data', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      ok({ code: 0, data: { 'MAP.0': 'chunk0', 'MAP.1': 'chunk1', 'MAP.info': '{"i":0}' } }),
    );
    const res = await getBatchDeviceDatas({ session, region: 'eu', did: 'D', fetchImpl }, ['MAP']);
    expect(res).toEqual({ 'MAP.0': 'chunk0', 'MAP.1': 'chunk1', 'MAP.info': '{"i":0}' });
  });

  it('returns {} when data is absent', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => ok({ code: 0 }));
    const res = await getBatchDeviceDatas({ session, region: 'eu', did: 'D', fetchImpl }, []);
    expect(res).toEqual({});
  });

  it('throws DreameApiError when code !== 0', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => ok({ code: 10001, msg: 'bad request' }));
    await expect(
      getBatchDeviceDatas({ session, region: 'eu', did: 'D', fetchImpl }, ['MAP']),
    ).rejects.toBeInstanceOf(DreameApiError);
  });
});
