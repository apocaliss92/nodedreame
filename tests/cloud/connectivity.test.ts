import { describe, it, expect } from 'vitest';
import { parseConnectivity } from '../../src/cloud/connectivity.js';

describe('parseConnectivity', () => {
  it('distills the connectivity view from a real record shape', () => {
    const c = parseConnectivity({
      online: true,
      mac: 'AA:BB:CC:DD:EE:FF',
      bindDomain: '10000.mt.eu.iot.dreame.tech:19973',
      region: 'eu',
      vendor: 'ali',
      ver: '1.2.3',
      sn: 'SN123',
      subModel: 'dreame.vacuum.r2538z',
      battery: 87,
      latestStatus: 13,
      deviceInfo: { scType: 'WIFI' },
    });
    expect(c).toEqual({
      online: true,
      connectionType: 'WIFI',
      mac: 'AA:BB:CC:DD:EE:FF',
      broker: { host: '10000.mt.eu.iot.dreame.tech', port: 19973 },
      region: 'eu',
      cloudVendor: 'ali',
      firmwareVersion: '1.2.3',
      serialNumber: 'SN123',
      subModel: 'dreame.vacuum.r2538z',
      battery: 87,
      statusCode: 13,
    });
  });

  it('is lenient: missing/empty fields become null, offline defaults false', () => {
    const c = parseConnectivity({});
    expect(c.online).toBe(false);
    expect(c.mac).toBeNull();
    expect(c.broker).toBeNull();
    expect(c.connectionType).toBeNull();
    expect(c.battery).toBeNull();
  });

  it('handles a bindDomain without a port', () => {
    expect(parseConnectivity({ bindDomain: 'broker.example' }).broker).toEqual({
      host: 'broker.example',
      port: null,
    });
  });
});
