import { describe, it, expect } from 'vitest';
import { MowerDevice } from '../../../src/models/mower/mower-device.js';
import { DreameError } from '../../../src/transport/errors.js';
import type { BaseDeviceDeps, PushLike } from '../../../src/device/base-device.js';
import type { DreameDevice, DreameSession, PropertyResult } from '../../../src/cloud/types.js';
import type { BatchDeviceDataFetcher } from '../../../src/models/mower/mower-device.js';

// NOTE: the mower was asleep during e2e capture — this test drives getMap()
// against a SYNTHETIC batch dict via an injected fetcher. No live network.

function fakeSession(): DreameSession {
  return { accessToken: 't', uid: 'u', expiresAt: Date.now() + 1e6, region: 'eu' };
}
function fakeDevice(model = 'dreame.mower.p2255'): DreameDevice {
  return { did: 'm1', model, name: 'Mowy', online: true, raw: {} };
}
function fakePush(): PushLike {
  const fp: PushLike = {
    on: () => fp,
    open: () => Promise.resolve(),
    close: () => Promise.resolve(),
    refreshSession: () => Promise.resolve(),
  };
  return fp;
}
function depsReturning(results: PropertyResult[]): BaseDeviceDeps {
  return {
    createPush: () => fakePush(),
    getProperties: () => Promise.resolve(results),
    getCachedProperties: () => Promise.resolve(results),
    setProperties: () => Promise.resolve([]),
    callAction: () => Promise.resolve({}),
  };
}

/** A synthetic batch dict carrying one mapIndex-0 map with a single zone. */
function syntheticBatch(): Record<string, unknown> {
  const mapA = JSON.stringify({
    name: 'Garden',
    mapIndex: 0,
    totalArea: 10000,
    mowingAreas: {
      dataType: 'Map',
      value: [
        [
          1,
          {
            path: [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
              { x: 100, y: 100 },
            ],
            name: 'Front',
            type: 2,
            shapeType: 1,
            area: 10000,
            time: 5,
            etime: 9,
          },
        ],
      ],
    },
  });
  const arrA = JSON.stringify([mapA]);
  return {
    'MAP.0': arrA,
    'MAP.info': String(arrA.length),
    'M_PATH.0': '[[1,1],[2,2]]',
    'M_PATH.info': '0',
  };
}

interface FetchRecord {
  did: string;
  props: string[];
}

function recordingFetcher(batch: Record<string, unknown>): {
  fn: BatchDeviceDataFetcher;
  calls: FetchRecord[];
} {
  const calls: FetchRecord[] = [];
  const fn: BatchDeviceDataFetcher = (did, props) => {
    calls.push({ did, props });
    return Promise.resolve(batch);
  };
  return { fn, calls };
}

function makeMower(fetcher: BatchDeviceDataFetcher, model = 'dreame.mower.p2255'): MowerDevice {
  return new MowerDevice({
    device: fakeDevice(model),
    region: 'eu',
    sessionRef: fakeSession,
    deps: depsReturning([]),
    fetchInitialValues: false,
    getBatchDeviceDatas: fetcher,
  });
}

describe('MowerDevice.getMap()', () => {
  it('fetches the batch, parses a MowerMap, and caches lastMap', async () => {
    const { fn, calls } = recordingFetcher(syntheticBatch());
    const m = makeMower(fn);
    await m.start();

    expect(m.lastMap).toBeNull();
    const map = await m.getMap();

    expect(map.zones.length).toBe(1);
    expect(map.zones[0]?.zoneId).toBe(1);
    expect(map.name).toBe('Garden');
    expect(m.lastMap).toBe(map);
    expect(calls.length).toBe(1);
    expect(calls[0]?.did).toBe('m1');
    expect(calls[0]?.props).toEqual(['MAP', 'M_PATH']);
    await m.close();
  });

  it('rejects with DreameError when the batch yields no parseable map', async () => {
    const { fn } = recordingFetcher({});
    const m = makeMower(fn);
    await m.start();
    await expect(m.getMap()).rejects.toBeInstanceOf(DreameError);
    await m.close();
  });

  it('rejects with DreameError when the model lacks map capability', async () => {
    const { fn } = recordingFetcher(syntheticBatch());
    const m = makeMower(fn, 'dreame.mower.unknownmodel');
    await m.start();
    await expect(m.getMap()).rejects.toBeInstanceOf(DreameError);
    await m.close();
  });

  it('falls back to the live cloud batch-fetch when no fetcher is injected', async () => {
    // With no fetcher injected, getMap now defaults to the live
    // `iotuserdata/getDeviceData` cloud call (endpoint recovered). Against a
    // fake session that resolves to an empty batch, it surfaces the "no
    // parseable map" DreameError rather than the old "no fetcher" guard.
    const m = new MowerDevice({
      device: fakeDevice(),
      region: 'eu',
      sessionRef: fakeSession,
      deps: depsReturning([]),
      fetchInitialValues: false,
      // override only the batch fetch to a deterministic empty result
      getBatchDeviceDatas: async () => ({}),
    });
    await m.start();
    await expect(m.getMap()).rejects.toBeInstanceOf(DreameError);
    await m.close();
  });
});

describe('MowerDevice.mapSvg()', () => {
  it('renders the cached/fetched map to an SVG string', async () => {
    const { fn, calls } = recordingFetcher(syntheticBatch());
    const m = makeMower(fn);
    await m.start();

    const svg = await m.mapSvg();
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    // fetched once to populate lastMap
    expect(calls.length).toBe(1);

    // second call reuses the cached map (no extra fetch)
    const svg2 = await m.mapSvg();
    expect(svg2).toContain('</svg>');
    expect(calls.length).toBe(1);
    await m.close();
  });
});

describe('MowerCapabilities.canMap', () => {
  it('defaults true for the p2255 model', () => {
    const { fn } = recordingFetcher(syntheticBatch());
    const m = makeMower(fn);
    expect(m.mowerCapabilities.canMap).toBe(true);
  });
});
