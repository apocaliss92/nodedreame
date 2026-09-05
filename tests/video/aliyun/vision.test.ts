import { describe, it, expect, vi } from 'vitest';
import type { FetchImpl } from '../../../src/transport/fetch.js';
import { streamQuery } from '../../../src/video/aliyun/vision.js';
import { DreameDeviceOfflineError } from '../../../src/transport/errors.js';

const ok = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });

// Response shape captured live from /vision/customer/stream/query (relayEncrypted:false).
const PLAIN = {
  code: 200,
  data: {
    typeList: ['Direct', 'Relay', 'NAT'],
    relayUrl: 'rtmp://iotx-vision-streaming-rtmp-eu-central-1.aliyuncs.com:8000/live?token=x&session=y/KEY_0',
    relayDecryptKey: {},
    p2pInfo: {
      stunUrl: '8.219.102.239:3478?key=abc',
      alterStunUrl: '47.245.98.233:3478?key=abc',
      signalUrl: 'wss://iotx-vision-p2p-signal-eu-central-1.aliyuncs.com:443/iotx/vision/p2p/request?token=t',
    },
    supportVisionPtz: true,
  },
  id: 'X',
};

describe('streamQuery', () => {
  it('returns a plain relay URL (no decrypt key) and signs the request', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => ok(PLAIN));
    const s = await streamQuery({
      regionId: 'eu-central-1',
      iotToken: 'TOKEN',
      iotId: 'IOT',
      relayEncrypted: false,
      fetchImpl,
    });
    expect(s.relayUrl).toContain('rtmp://');
    expect(s.relayDecryptKey).toBeNull();
    expect(s.p2pInfo?.signalUrl).toContain('wss://');
    expect(s.supportVisionPtz).toBe(true);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://eu-central-1.api-iot.aliyuncs.com/vision/customer/stream/query');
    const h = init?.headers as Record<string, string>;
    expect(h['X-Ca-Signature']).toBeTruthy();
    expect(h['X-Ca-Signature-Headers']).toContain('X-Ca-Stage');
    expect(h['Content-MD5']).toBeTruthy();
    const sent = JSON.parse(String(init?.body));
    expect(sent.params.relayEncrypted).toBe(false);
    expect(sent.params.iotId).toBe('IOT');
    expect(sent.request.iotToken).toBe('TOKEN');
  });

  it('surfaces the AES decrypt key when the relay is encrypted', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      ok({ code: 200, data: { relayUrl: 'rtmp://x', relayDecryptKey: { iv: 'IV', key: 'K' } } }),
    );
    const s = await streamQuery({ regionId: 'eu-central-1', iotToken: 'T', iotId: 'I', relayEncrypted: true, fetchImpl });
    expect(s.relayDecryptKey).toEqual({ iv: 'IV', key: 'K' });
  });

  it('throws on a non-200 vision code', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => ok({ code: 29003, message: 'token invalid' }));
    await expect(
      streamQuery({ regionId: 'eu-central-1', iotToken: 'T', iotId: 'I', fetchImpl }),
    ).rejects.toThrow(/stream\/query rejected/);
  });

  it('throws DreameDeviceOfflineError on code 9201 (retryable wake)', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => ok({ code: 9201, message: 'device offline' }));
    await expect(
      streamQuery({ regionId: 'eu-central-1', iotToken: 'T', iotId: 'I', fetchImpl }),
    ).rejects.toBeInstanceOf(DreameDeviceOfflineError);
  });
});
