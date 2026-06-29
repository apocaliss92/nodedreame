import { describe, it, expect } from 'vitest';
import { VacuumDevice } from '../../../src/models/vacuum/vacuum-device.js';
import { OssFetcher } from '../../../src/models/vacuum/map/oss-fetch.js';
import { DreameError } from '../../../src/transport/errors.js';
import { buildSyntheticFrame } from './map/fixtures/build-frame.js';
import type { BaseDeviceDeps, PushLike } from '../../../src/device/base-device.js';
import type { DreameDevice, DreameSession, PropertyResult } from '../../../src/cloud/types.js';
import type { VacuumMap } from '../../../src/models/vacuum/map/index.js';
import type { OssFetchInput } from '../../../src/models/vacuum/map/oss-fetch.js';

// NOTE: robots were asleep during e2e capture — this test drives getMap()
// against a SYNTHETIC frame builder via a fake OssFetcher. No live network.

const WALL = 63 << 2;
const FLOOR = 62 << 2;
const SEG5 = 5 << 2;

function fakeSession(): DreameSession {
  return { accessToken: 't', uid: 'u', expiresAt: Date.now() + 1e6, region: 'eu' };
}

function fakeDevice(model = 'dreame.vacuum.r2538z'): DreameDevice {
  return { did: 'd1', model, name: 'Robi', online: true, raw: {} };
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

/** A fake OssFetcher whose fetchBlob returns a synthetic inflated frame (no AES). */
class FakeOssFetcher extends OssFetcher {
  #blob: Buffer;
  calls: OssFetchInput[] = [];
  constructor(blob: Buffer) {
    super();
    this.#blob = blob;
  }
  override fetchBlob(input: OssFetchInput): Promise<Buffer> {
    this.calls.push(input);
    return Promise.resolve(this.#blob);
  }
}

function activeSegmentFrame(): Buffer {
  // 4-wide x 2-tall: wall row, then a seg5 region. tail.sa marks seg 5 active.
  const grid = Buffer.from([WALL, WALL, WALL, WALL, FLOOR, FLOOR, SEG5, SEG5]);
  return buildSyntheticFrame({
    mapId: 7,
    frameId: 1,
    frameType: 'I',
    robot: { x: 0, y: 0, a: 0 },
    charger: { x: 0, y: 0, a: 0 },
    gridSize: 50,
    width: 4,
    height: 2,
    left: 0,
    top: 0,
    grid,
    tail: { timestamp_ms: 1, seg_inf: { '5': { name: '' } }, sa: [[5]] },
  }).inflated;
}

function makeVacuum(model = 'dreame.vacuum.r2538z'): VacuumDevice {
  return new VacuumDevice({
    device: fakeDevice(model),
    region: 'eu',
    sessionRef: fakeSession,
    deps: depsReturning([]),
    fetchInitialValues: false,
  });
}

describe('VacuumDevice.getMap()', () => {
  it('fetches via the injected fetcher, decodes, and caches lastMap', async () => {
    const fetcher = new FakeOssFetcher(activeSegmentFrame());
    const v = makeVacuum();
    await v.start();

    expect(v.lastMap).toBeNull();
    const map = await v.getMap({ filename: 'ali_dreame/u/d1/9', fetcher });

    expect(map.mapId).toBe(7);
    expect(map.segments.length).toBe(1);
    expect(v.lastMap).toBe(map);
    // the fetcher was called with the device's did/model/region + filename
    expect(fetcher.calls.length).toBe(1);
    expect(fetcher.calls[0]?.did).toBe('d1');
    expect(fetcher.calls[0]?.model).toBe('dreame.vacuum.r2538z');
    expect(fetcher.calls[0]?.filename).toBe('ali_dreame/u/d1/9');
    await v.close();
  });

  it('emits a "map" event carrying the decoded map', async () => {
    const fetcher = new FakeOssFetcher(activeSegmentFrame());
    const v = makeVacuum();
    await v.start();

    const seen: VacuumMap[] = [];
    v.on('map', (m) => {
      seen.push(m);
    });
    const map = await v.getMap({ filename: 'f', fetcher });
    expect(seen.length).toBe(1);
    expect(seen[0]).toBe(map);
    await v.close();
  });

  it('rejects with DreameError when the model lacks map capability', async () => {
    // A model NOT in MODEL_CAPABILITIES → fallback record → canMap false.
    const v = makeVacuum('dreame.vacuum.unknownmodel');
    await v.start();
    const fetcher = new FakeOssFetcher(activeSegmentFrame());
    await expect(v.getMap({ filename: 'f', fetcher })).rejects.toBeInstanceOf(DreameError);
    await v.close();
  });
});

describe('VacuumDevice.currentSegmentId', () => {
  it('returns the id of the first active segment of lastMap', async () => {
    const fetcher = new FakeOssFetcher(activeSegmentFrame());
    const v = makeVacuum();
    await v.start();
    expect(v.currentSegmentId).toBeNull(); // no map yet
    await v.getMap({ filename: 'f', fetcher });
    expect(v.currentSegmentId).toBe(5);
    await v.close();
  });

  it('returns null when no segment is active', async () => {
    const grid = Buffer.from([WALL, WALL, FLOOR, FLOOR]);
    const inflated = buildSyntheticFrame({
      mapId: 1,
      frameId: 0,
      frameType: 'I',
      robot: { x: 0, y: 0, a: 0 },
      charger: { x: 0, y: 0, a: 0 },
      gridSize: 50,
      width: 2,
      height: 2,
      left: 0,
      top: 0,
      grid,
      tail: { timestamp_ms: 1 },
    }).inflated;
    const v = makeVacuum();
    await v.start();
    await v.getMap({ filename: 'f', fetcher: new FakeOssFetcher(inflated) });
    expect(v.currentSegmentId).toBeNull();
    await v.close();
  });
});

describe('VacuumCapabilities.canMap', () => {
  it('defaults true for the r2538z model', () => {
    const v = makeVacuum();
    expect(v.vacuumCapabilities.canMap).toBe(true);
  });
});

describe('VacuumDevice.mapFilename', () => {
  it('returns the seeded MAP_PATH (siid 6 piid 3) OSS object name', async () => {
    const v = new VacuumDevice({
      device: fakeDevice(),
      region: 'eu',
      sessionRef: fakeSession,
      deps: depsReturning([{ siid: 6, piid: 3, value: 'ali_dreame/u/d1/9', code: 0 }]),
      fetchInitialValues: false,
    });
    await v.start();
    expect(v.mapFilename).toBeNull(); // not observed until a refresh/push lands it
    await v.refreshProperties([{ siid: 6, piid: 3 }]);
    expect(v.mapFilename).toBe('ali_dreame/u/d1/9');
    await v.close();
  });

  it('treats an empty/absent map path as null', async () => {
    const v = new VacuumDevice({
      device: fakeDevice(),
      region: 'eu',
      sessionRef: fakeSession,
      deps: depsReturning([{ siid: 6, piid: 3, value: '', code: 0 }]),
      fetchInitialValues: false,
    });
    await v.start();
    await v.refreshProperties([{ siid: 6, piid: 3 }]);
    expect(v.mapFilename).toBeNull();
    await v.close();
  });
});

describe('VacuumDevice.fetchLatestMap()', () => {
  it('reads mapFilename then delegates to getMap (caches lastMap, forwards fetcher)', async () => {
    const fetcher = new FakeOssFetcher(activeSegmentFrame());
    const v = new VacuumDevice({
      device: fakeDevice(),
      region: 'eu',
      sessionRef: fakeSession,
      deps: depsReturning([{ siid: 6, piid: 3, value: 'ali_dreame/u/d1/7', code: 0 }]),
      fetchInitialValues: false,
    });
    await v.start();
    await v.refreshProperties([{ siid: 6, piid: 3 }]);
    const map = await v.fetchLatestMap({ fetcher });
    expect(map).not.toBeNull();
    expect(v.lastMap).toBe(map);
    expect(fetcher.calls.length).toBe(1);
    expect(fetcher.calls[0]?.filename).toBe('ali_dreame/u/d1/7');
    await v.close();
  });

  it('returns null (without fetching) when no map filename has been observed', async () => {
    const fetcher = new FakeOssFetcher(activeSegmentFrame());
    const v = makeVacuum();
    await v.start();
    const map = await v.fetchLatestMap({ fetcher });
    expect(map).toBeNull();
    expect(fetcher.calls.length).toBe(0);
    await v.close();
  });
});
