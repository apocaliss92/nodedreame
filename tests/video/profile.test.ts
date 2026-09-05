import { describe, it, expect } from 'vitest';
import { toVideoProfile } from '../../src/video/profile.js';
import type { DeviceInfoRecord } from '../../src/video/schemas.js';

// Shapes captured live from an X50 Ultra Complete (dreame.vacuum.r2538z).
const aliDevice: DeviceInfoRecord = {
  did: 'DID_ABC',
  model: 'dreame.vacuum.r2538z',
  vendor: 'ali',
  online: true,
  property: JSON.stringify({ iotId: '2TRfZjMMI7zw83bzEe78000000', lwt: 1, mac: 'x' }),
  deviceInfo: {
    displayName: 'X50 Ultra Complete',
    permit: 'video',
    videoDynamicVendor: true,
    defaultVendors: ['tx', 'ali'],
  },
};

describe('toVideoProfile', () => {
  it('derives an Aliyun profile with iotId and supported vendors', () => {
    const p = toVideoProfile(aliDevice);
    expect(p.did).toBe('DID_ABC');
    expect(p.model).toBe('dreame.vacuum.r2538z');
    expect(p.displayName).toBe('X50 Ultra Complete');
    expect(p.videoCapable).toBe(true);
    expect(p.currentVendor).toBe('ali');
    expect(p.supportedVendors).toEqual(['tx', 'ali']);
    expect(p.dynamicVendor).toBe(true);
    expect(p.iotId).toBe('2TRfZjMMI7zw83bzEe78000000');
    expect(p.online).toBe(true);
  });

  it('treats an empty vendor as null and reads online from lwt', () => {
    const p = toVideoProfile({
      ...aliDevice,
      vendor: '',
      online: false,
      property: JSON.stringify({ lwt: 1 }),
    });
    expect(p.currentVendor).toBeNull();
    expect(p.iotId).toBeNull();
    expect(p.online).toBe(true);
  });

  it('marks a camera-less device (no permit, no vendors) as not video-capable', () => {
    const p = toVideoProfile({
      did: 'D2',
      model: 'dreame.mower.p2255',
      deviceInfo: { displayName: 'A1', defaultVendors: [] },
    });
    expect(p.videoCapable).toBe(false);
    expect(p.supportedVendors).toEqual([]);
    expect(p.iotId).toBeNull();
  });

  it('ignores malformed property JSON without throwing', () => {
    const p = toVideoProfile({ ...aliDevice, property: '{not json' });
    expect(p.iotId).toBeNull();
  });

  it('drops unknown vendors from supportedVendors', () => {
    const p = toVideoProfile({
      ...aliDevice,
      deviceInfo: { ...aliDevice.deviceInfo, defaultVendors: ['tx', 'agora', 'ali'] },
    });
    expect(p.supportedVendors).toEqual(['tx', 'ali']);
  });
});
