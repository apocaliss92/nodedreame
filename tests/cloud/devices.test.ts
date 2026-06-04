import { describe, it, expect, vi } from 'vitest';
import { listDevices } from '../../src/cloud/devices.js';
import type { DreameSession } from '../../src/cloud/types.js';
import type { FetchImpl } from '../../src/transport/fetch.js';

const session: DreameSession = {
  accessToken: 'TOK',
  uid: 'u',
  expiresAt: Date.now() + 1e6,
  region: 'eu',
};

const ok = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });

describe('listDevices', () => {
  it('POSTs to listV2 and maps nested page.records into DreameDevice[]', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      ok({
        code: 0,
        data: {
          page: {
            records: [
              {
                did: 'DID-VAC',
                model: 'dreame.vacuum.r2532a',
                customName: 'Vacuum',
                mac: 'aa:bb',
                online: true,
                bindDomain: '10000.mt.eu.iot.dreame.tech:19973',
                ver: '4.3.9_2199',
                sn: 'SN1',
                battery: 80,
                latestStatus: 13,
              },
              { did: 'DID-MOW', model: 'dreame.mower.p2255', deviceName: 'Mower', online: false },
            ],
          },
        },
      }),
    );

    const devices = await listDevices({ session, region: 'eu', fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://eu.iot.dreame.tech:13267/dreame-user-iot/iotuserbind/device/listV2');
    const body = JSON.parse(init!.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ sharedStatus: 1, current: 1, size: 100, lang: 'en' });
    expect(typeof body.timestamp).toBe('number');

    expect(devices).toHaveLength(2);
    const vac = devices[0]!;
    expect(vac.did).toBe('DID-VAC');
    expect(vac.model).toBe('dreame.vacuum.r2532a');
    expect(vac.name).toBe('Vacuum');
    expect(vac.mac).toBe('aa:bb');
    expect(vac.online).toBe(true);
    expect(vac.firmwareVersion).toBe('4.3.9_2199');
    expect(vac.serialNumber).toBe('SN1');
    expect(vac.raw.bindDomain).toBe('10000.mt.eu.iot.dreame.tech:19973');
    expect(vac.cloudState?.battery).toBe(80);
    expect(vac.cloudState?.latestStatus).toBe(13);

    const mow = devices[1]!;
    expect(mow.name).toBe('Mower');
    expect(mow.online).toBe(false);
  });

  it('honours online via lwt in the property JSON string', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      ok({ code: 0, data: { records: [{ did: 'D', model: 'm', property: '{"lwt":1}' }] } }),
    );
    const devices = await listDevices({ session, region: 'eu', fetchImpl });
    expect(devices[0]?.online).toBe(true);
  });

  it('returns [] when no records present', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => ok({ code: 0, data: {} }));
    const devices = await listDevices({ session, region: 'eu', fetchImpl });
    expect(devices).toEqual([]);
  });
});
