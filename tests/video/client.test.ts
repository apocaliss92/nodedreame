import { describe, it, expect, vi } from 'vitest';
import type { FetchImpl } from '../../src/transport/fetch.js';
import type { DreameSession } from '../../src/cloud/types.js';
import {
  getVideoAccessToken,
  getAliyunAuthCode,
  getVideoFamilyId,
  getDeviceVideoProfile,
  getTencentIdentity,
  getTencentP2PInfo,
} from '../../src/video/client.js';
import { DreameApiError } from '../../src/transport/errors.js';

const session: DreameSession = {
  accessToken: 'ACCESS',
  uid: 'u1',
  expiresAt: Date.now() + 3_600_000,
  region: 'eu',
};

const okResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

const base = (fetchImpl: FetchImpl) => ({ session, region: 'eu' as const, fetchImpl });

describe('getVideoAccessToken', () => {
  it('parses the double-nested payload and converts expiry to ms', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      okResponse({
        code: 0,
        success: true,
        data: { requestId: 'r', data: { token: 'VT', userId: 123, expireAt: 1_789_219_146 } },
      }),
    );
    const t = await getVideoAccessToken(base(fetchImpl));
    expect(t.token).toBe('VT');
    expect(t.userId).toBe('123');
    expect(t.expiresAt).toBe(1_789_219_146 * 1000);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://eu.iot.dreame.tech:13267/dreame-third-video/tx/user/accesstoken');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ os: 'android' });
    expect((init?.headers as Record<string, string>)['dreame-auth']).toBe('bearer ACCESS');
  });

  it('throws DreameApiError on a non-zero code', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      okResponse({ code: 10007, success: false, msg: 'os:must not be null' }),
    );
    await expect(getVideoAccessToken(base(fetchImpl))).rejects.toBeInstanceOf(DreameApiError);
  });
});

describe('getAliyunAuthCode', () => {
  it('returns the hex authCode blob', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      okResponse({ code: 0, success: true, data: 'aee6d880deadbeef' }),
    );
    await expect(getAliyunAuthCode(base(fetchImpl))).resolves.toBe('aee6d880deadbeef');
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      'https://eu.iot.dreame.tech:13267/dreame-smarthome/aliIot/getAuthCodeV3',
    );
  });
});

describe('getVideoFamilyId', () => {
  it('sends the supplied video token and extracts data.data.familyId', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      okResponse({ code: 0, success: true, data: { requestId: 'r', data: { familyId: 'f_1' } } }),
    );
    await expect(getVideoFamilyId({ ...base(fetchImpl), videoToken: 'VT' })).resolves.toBe('f_1');
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body))).toEqual({
      accesstoken: 'VT',
      os: 'android',
    });
  });

  it('mints a video token first when none is supplied', async () => {
    const fetchImpl = vi
      .fn<FetchImpl>()
      .mockResolvedValueOnce(
        okResponse({ code: 0, data: { data: { token: 'VT', expireAt: 1 } } }),
      )
      .mockResolvedValueOnce(
        okResponse({ code: 0, data: { data: { familyId: 'f_1' } } }),
      );
    await expect(getVideoFamilyId(base(fetchImpl))).resolves.toBe('f_1');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchImpl.mock.calls[1]![1]?.body)).accesstoken).toBe('VT');
  });
});

describe('getDeviceVideoProfile', () => {
  it('maps a device/info record to a profile', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      okResponse({
        code: 0,
        success: true,
        data: {
          did: 'DID_ABC',
          model: 'dreame.vacuum.r2538z',
          vendor: 'ali',
          online: true,
          property: JSON.stringify({ iotId: 'IOT_1', lwt: 1 }),
          deviceInfo: {
            displayName: 'X50 Ultra Complete',
            permit: 'video',
            videoDynamicVendor: true,
            defaultVendors: ['tx', 'ali'],
          },
        },
      }),
    );
    const p = await getDeviceVideoProfile({ ...base(fetchImpl), did: 'DID_ABC' });
    expect(p.iotId).toBe('IOT_1');
    expect(p.currentVendor).toBe('ali');
    expect(p.videoCapable).toBe(true);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body))).toEqual({ did: 'DID_ABC' });
  });
});

/**
 * THE TENCENT CONTROL PLANE.
 *
 * Shapes captured live from an X50 Ultra Complete on 2026-09-16, the day the
 * device moved to `vendor: tx`. On 2026-09-05 the SAME device was on `ali` and
 * every one of these answered `设备三元组不存在` — the triple does not exist —
 * which is why a failure here is a statement about the device's vendor and not
 * a fault in the call.
 */
describe('getTencentIdentity', () => {
  it('parses the device triple', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async (url) =>
      String(url).includes('accesstoken')
        ? okResponse({ code: 0, data: { data: { token: 'VT', userId: 1, expireAt: 9_999_999_999 } } })
        : okResponse({
            code: 0,
            success: true,
            data: {
              requestId: 'r',
              data: {
                productId: 'PXL5Y08V1E',
                deviceName: 'XHK3T19TUD6s1jtf',
                deviceId: 'PXL5Y08V1E/XHK3T19TUD6s1jtf',
                secretId: 'SID',
                secretKey: 'SKEY',
              },
            },
          }),
    );
    const id = await getTencentIdentity({ ...base(fetchImpl), did: 'DID_ABC' });
    expect(id.productId).toBe('PXL5Y08V1E');
    expect(id.deviceName).toBe('XHK3T19TUD6s1jtf');
    expect(id.deviceId).toBe('PXL5Y08V1E/XHK3T19TUD6s1jtf');
  });

  // The secrets are optional in the wire shape and absent for some accounts;
  // a device without them is still a device, not a parse failure.
  it('survives a triple with no secrets', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async (url) =>
      String(url).includes('accesstoken')
        ? okResponse({ code: 0, data: { data: { token: 'VT', userId: 1, expireAt: 9_999_999_999 } } })
        : okResponse({
            code: 0,
            data: { data: { productId: 'P', deviceName: 'D' } },
          }),
    );
    const id = await getTencentIdentity({ ...base(fetchImpl), did: 'DID' });
    expect(id.secretId).toBeNull();
    expect(id.secretKey).toBeNull();
  });

  it('carries the did the cloud keys on', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async (url) =>
      String(url).includes('accesstoken')
        ? okResponse({ code: 0, data: { data: { token: 'VT', userId: 1, expireAt: 9_999_999_999 } } })
        : okResponse({ code: 0, data: { data: { productId: 'P', deviceName: 'D' } } }),
    );
    await getTencentIdentity({ ...base(fetchImpl), did: 'DID_ABC' });
    const [, init] = fetchImpl.mock.calls[1]!;
    expect(String(init?.body)).toContain('DID_ABC');
  });

  it('refuses a device that is not on tx, like any other cloud refusal', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async (url) =>
      String(url).includes('accesstoken')
        ? okResponse({ code: 0, data: { data: { token: 'VT', userId: 1, expireAt: 9_999_999_999 } } })
        : okResponse({ code: 10400, success: false, msg: '设备三元组不存在' }),
    );
    await expect(
      getTencentIdentity({ ...base(fetchImpl), did: 'DID' }),
    ).rejects.toBeInstanceOf(DreameApiError);
  });
});

describe('getTencentP2PInfo', () => {
  /**
   * The descriptor is OPAQUE — 35 characters, not JSON, on the measured X50.
   * Nothing parses it, and this pins that: a future "helpful" parse would be
   * inventing structure that is not there.
   */
  it('carries the descriptor through without interpreting it', async () => {
    const opaque = 'ypVXKzGmMUSCmfeDgBgYLwXkAZgyxJBBWQx';
    const fetchImpl = vi.fn<FetchImpl>(async (url) =>
      String(url).includes('accesstoken')
        ? okResponse({ code: 0, data: { data: { token: 'VT', userId: 1, expireAt: 9_999_999_999 } } })
        : okResponse({ code: 0, data: { requestId: 'r', data: { p2pInfo: opaque } } }),
    );
    const d = await getTencentP2PInfo({ ...base(fetchImpl), did: 'DID' });
    expect(d.p2pInfo).toBe(opaque);
  });
})
