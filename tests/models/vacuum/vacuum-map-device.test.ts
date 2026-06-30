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

/** An OssFetcher that returns a different blob on each successive call. */
class SequenceOssFetcher extends OssFetcher {
  #blobs: Buffer[];
  #i = 0;
  constructor(blobs: Buffer[]) {
    super();
    this.#blobs = blobs;
  }
  override fetchBlob(): Promise<Buffer> {
    const blob = this.#blobs[Math.min(this.#i, this.#blobs.length - 1)];
    this.#i += 1;
    return Promise.resolve(blob ?? Buffer.alloc(0));
  }
}

function iFrame(mapId: number, frameId: number, grid: number[]): Buffer {
  return buildSyntheticFrame({
    mapId,
    frameId,
    frameType: 'I',
    robot: { x: 10, y: 10, a: 0 },
    charger: { x: 0, y: 0, a: 0 },
    gridSize: 50,
    width: 4,
    height: 4,
    left: 0,
    top: 0,
    grid: Buffer.from(grid),
    tail: { timestamp_ms: 1, tr: 'S100,100', seg_inf: { '5': {} }, sa: [[5]], origin: [0, 0] },
  }).inflated;
}

function pFrame(mapId: number, frameId: number, delta: number[]): Buffer {
  return buildSyntheticFrame({
    mapId,
    frameId,
    frameType: 'P',
    robot: { x: 20, y: 20, a: 0 },
    charger: { x: 0, y: 0, a: 0 },
    gridSize: 50,
    width: 4,
    height: 4,
    left: 0,
    top: 0,
    grid: Buffer.from(delta),
    tail: { timestamp_ms: 2, tr: 'L10,0', origin: [0, 0] },
  }).inflated;
}

function vacuumWithMapPath(filename = 'ali_dreame/u/d1/9'): VacuumDevice {
  return new VacuumDevice({
    device: fakeDevice(),
    region: 'eu',
    sessionRef: fakeSession,
    deps: depsReturning([{ siid: 6, piid: 3, value: filename, code: 0 }]),
    fetchInitialValues: false,
  });
}

describe('VacuumDevice.fetchLatestMapStreaming()', () => {
  const I_GRID = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
  const P_DELTA = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

  it('seeds on an I-frame then merges a following P-frame into a complete map', async () => {
    const fetcher = new SequenceOssFetcher([iFrame(5, 0, I_GRID), pFrame(5, 1, P_DELTA)]);
    const v = vacuumWithMapPath();
    await v.start();
    await v.refreshProperties([{ siid: 6, piid: 3 }]);

    const first = await v.fetchLatestMapStreaming({ fetcher });
    expect(first?.frameType).toBe('I');
    expect(first?.mapId).toBe(5);

    const second = await v.fetchLatestMapStreaming({ fetcher });
    expect(second).not.toBeNull();
    // The merged frame is re-stamped as an I-frame (a complete grid), advanced
    // to the P-frame's frameId — proof the delta was folded onto the base.
    expect(second?.frameType).toBe('I');
    expect(second?.frameId).toBe(1);
    expect(second?.mapId).toBe(5);
    expect(v.lastMap).toBe(second);
    await v.close();
  });

  it('returns null for a P-frame arriving before any I-frame', async () => {
    const fetcher = new SequenceOssFetcher([pFrame(5, 1, P_DELTA)]);
    const v = vacuumWithMapPath();
    await v.start();
    await v.refreshProperties([{ siid: 6, piid: 3 }]);
    expect(await v.fetchLatestMapStreaming({ fetcher })).toBeNull();
    await v.close();
  });

  it('drops the base on an out-of-order P-frame and re-seeds on the next I-frame', async () => {
    // I(frameId 0) → P(frameId 5, out of order) → I(frameId 0) re-seed.
    const fetcher = new SequenceOssFetcher([
      iFrame(5, 0, I_GRID),
      pFrame(5, 5, P_DELTA),
      iFrame(5, 0, I_GRID),
    ]);
    const v = vacuumWithMapPath();
    await v.start();
    await v.refreshProperties([{ siid: 6, piid: 3 }]);

    expect((await v.fetchLatestMapStreaming({ fetcher }))?.frameType).toBe('I');
    expect(await v.fetchLatestMapStreaming({ fetcher })).toBeNull(); // out-of-order → base dropped
    expect((await v.fetchLatestMapStreaming({ fetcher }))?.frameType).toBe('I'); // re-seeded
    await v.close();
  });

  it('returns null without fetching when no map filename is observed', async () => {
    const fetcher = new SequenceOssFetcher([iFrame(5, 0, I_GRID)]);
    const v = makeVacuum();
    await v.start();
    expect(await v.fetchLatestMapStreaming({ fetcher })).toBeNull();
    await v.close();
  });
});

describe('VacuumDevice.refreshSavedMapFilename()', () => {
  it('seeds mapFilename from the cloud shadow and returns it', async () => {
    const v = new VacuumDevice({
      device: fakeDevice(),
      region: 'eu',
      sessionRef: fakeSession,
      deps: depsReturning([{ siid: 6, piid: 3, value: 'ali_dreame/u/d1/saved', code: 0 }]),
      fetchInitialValues: false,
    });
    await v.start();
    expect(v.mapFilename).toBeNull(); // shadow not read yet
    const fn = await v.refreshSavedMapFilename();
    expect(fn).toBe('ali_dreame/u/d1/saved');
    expect(v.mapFilename).toBe('ali_dreame/u/d1/saved');
    await v.close();
  });
});
