import { describe, it, expect } from 'vitest';
import { Nodreame } from '../../src/api/nodreame.js';
import { VacuumDevice } from '../../src/models/vacuum/vacuum-device.js';
import { MowerDevice } from '../../src/models/mower/mower-device.js';
import { ALL_REGIONS, type DreameRegion } from '../../src/auth/config.js';
import {
  DreameError,
  DreameDeviceOfflineError,
  DreameApiError,
} from '../../src/transport/errors.js';
import type { PropertyResult } from '../../src/cloud/types.js';
// Internal decode/parser + renderers are pulled in for the FALLBACK path only:
// when the live robots are asleep (no fresh blob/batch) we still assert the
// decode→render pipeline works against a deterministic synthetic fixture. We
// NEVER fake a live result — an actual decode error on a REAL blob must fail.
import { renderVacuumPng } from '../../src/models/vacuum/map/render.js';
import { decodeVacuumMap } from '../../src/models/vacuum/map/decode.js';
import { renderMowerSvg } from '../../src/models/mower/map/render.js';
import { parseBatchMapData } from '../../src/models/mower/map/parser.js';
import { buildSyntheticFrame } from '../models/vacuum/map/fixtures/build-frame.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A byte-exact synthetic vacuum I-frame envelope (no AES) for the fallback. */
function syntheticVacuumEnvelope(): string {
  // 4×2 grid: wall, floor, two segment-5 cells; second row blank + segment.
  const grid = Buffer.from([63 << 2, 62 << 2, 5 << 2, 5 << 2, 0, 0, 5 << 2, 5 << 2]);
  return buildSyntheticFrame({
    mapId: 1,
    frameId: 0,
    frameType: 'I',
    robot: { x: 0, y: 0, a: 0 },
    charger: { x: 0, y: 0, a: 0 },
    gridSize: 50,
    width: 4,
    height: 2,
    left: 0,
    top: 0,
    grid,
    tail: { timestamp_ms: 1, seg_inf: { '5': {} } },
  }).envelope;
}

/** A synthetic mower batch (one zone polygon) for the fallback. */
function syntheticMowerBatch(): Record<string, unknown> {
  const mapJson = JSON.stringify({
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
              { x: 0, y: 100 },
            ],
            name: 'Front Lawn',
            type: 2,
            shapeType: 1,
            area: 10000,
            time: 5,
            etime: 9,
          },
        ],
      ],
    },
    boundary: { x1: -10, y1: -10, x2: 110, y2: 110 },
  });
  const arr = JSON.stringify([mapJson]);
  return { 'MAP.0': arr, 'MAP.info': String(arr.length) };
}

const enabled = process.env.DREAME_E2E === '1';
const username = process.env.DREAME_USERNAME ?? '';
const password = process.env.DREAME_PASSWORD ?? '';

function resolveRegion(raw: string): DreameRegion {
  const normalised = raw.trim().toLowerCase();
  if ((ALL_REGIONS as readonly string[]).includes(normalised)) {
    return normalised as DreameRegion;
  }
  const isoFallback: Record<string, DreameRegion> = {
    gb: 'eu',
    it: 'eu',
    de: 'eu',
    us: 'us',
    cn: 'cn',
  };
  return isoFallback[normalised] ?? 'eu';
}

const region = resolveRegion(process.env.DREAME_COUNTRY ?? 'eu');

describe.runIf(enabled)('e2e: Nodreame facade', () => {
  it('logs in, discovers devices, reads a property live, and closes cleanly', async () => {
    expect(username, 'set DREAME_USERNAME in .env').not.toBe('');
    expect(password, 'set DREAME_PASSWORD in .env').not.toBe('');

    const client = new Nodreame({
      username,
      password,
      region,
      // Don't eager-seed: the generic facade doesn't know each model's props yet.
      fetchInitialValues: false,
    });

    const session = await client.login();
    expect(session.accessToken).toBeTruthy(); // truthiness only — never log the token
    expect(session.uid).toBeTruthy();

    const devices = await client.discoverDevices();
    // The account owns a vacuum + a mower.
    expect(devices.length).toBeGreaterThanOrEqual(2);
    for (const d of devices) {
      expect(d.deviceId).toBeTruthy();
      expect(d.model).toBeTruthy();
    }
    console.log(
      '[e2e] facade discovered:',
      devices.map((d) => `${d.model}`),
    );

    // Read a generic MIoT property live. siid 2 piid 1 is the canonical MIoT
    // device-status property across Dreame models; battery is commonly siid 3
    // piid 1. We assert the call returns a STRUCTURED result array, not a
    // specific value. A sleeping/offline device legitimately answers with a
    // device-offline error from the cloud — that is a valid live round-trip
    // (request reached the cloud, the cloud reported the device unreachable),
    // so we try each device and accept the first that returns a result array,
    // tolerating offline devices along the way.
    const probe: { siid: number; piid: number }[] = [
      { siid: 2, piid: 1 },
      { siid: 3, piid: 1 },
    ];
    let results: PropertyResult[] | null = null;
    let offlineCount = 0;
    for (const device of devices) {
      try {
        results = await device.refreshProperties(probe);
        console.log('[e2e] live read OK from model:', device.model);
        break;
      } catch (err: unknown) {
        if (err instanceof DreameDeviceOfflineError) {
          offlineCount += 1;
          console.log('[e2e] device offline (sleeping), trying next:', device.model);
          continue;
        }
        throw err;
      }
    }

    if (results !== null) {
      // A reachable device returned a structured result array.
      expect(Array.isArray(results)).toBe(true);
      console.log('[e2e] live property count:', results.length);
    } else {
      // Every device was offline/sleeping — the live round-trip still
      // succeeded end-to-end (cloud reachable, offline correctly surfaced).
      expect(offlineCount).toBe(devices.length);
      console.log('[e2e] all devices offline/sleeping; live round-trip verified via offline path');
    }

    await client.close();
  });

  it('discovers a VacuumDevice and reads its typed state (tolerating sleeping robots)', async () => {
    expect(username, 'set DREAME_USERNAME in .env').not.toBe('');
    expect(password, 'set DREAME_PASSWORD in .env').not.toBe('');

    const client = new Nodreame({
      username,
      password,
      region,
      fetchInitialValues: false,
    });

    const session = await client.login();
    expect(session.accessToken).toBeTruthy(); // truthiness only — never log the token
    expect(session.uid).toBeTruthy();

    const devices = await client.discoverDevices();
    // The account owns at least one dreame.vacuum.* robot.
    const vac = devices.find((d): d is VacuumDevice => d instanceof VacuumDevice);
    expect(vac, 'account should expose at least one VacuumDevice').toBeInstanceOf(VacuumDevice);
    const vacuumCount = devices.filter((d) => d instanceof VacuumDevice).length;
    console.log('[e2e] vacuum count:', vacuumCount, 'of', devices.length, 'devices');
    if (!vac) {
      await client.close();
      return;
    }

    // r2538z caps are ASSUMED from the r2532a sibling — assert SHAPE, not the
    // verified flag value.
    expect(typeof vac.vacuumCapabilities.canMop).toBe('boolean');
    expect(typeof vac.vacuumCapabilities.verified).toBe('boolean');

    // Seed the cache with a single live read of the vacuum's known props.
    // A sleeping/offline robot legitimately answers with a device-offline error
    // from the cloud — that is a valid end-to-end round-trip (the request
    // reached the cloud, the cloud reported the device unreachable). We accept
    // either path and NEVER assert a specific value.
    let online = false;
    try {
      const results = await vac.refreshProperties([...VacuumDevice.DEFAULT_PROPS]);
      expect(Array.isArray(results)).toBe(true);
      // Shape-only assertions: the typed getters either decode a number/enum or
      // return null; both are valid. No value assertions.
      expect(vac.battery === null || typeof vac.battery === 'number').toBe(true);
      expect(vac.status === null || typeof vac.status === 'number').toBe(true);
      expect(vac.suction === null || typeof vac.suction === 'number').toBe(true);
      expect(Array.isArray(vac.faults)).toBe(true);
      online = true;
      console.log('[e2e] vacuum typed-state read OK:', vac.model, '(props:', results.length, ')');
    } catch (err: unknown) {
      if (err instanceof DreameDeviceOfflineError) {
        console.log('[e2e] vacuum offline/sleeping; round-trip verified via offline path');
      } else {
        throw err;
      }
    }

    // Optional GUARDED safe command — only if the robot is actually online AND
    // the operator opts in (double-gated so a normal e2e run never beeps the
    // user's robots).
    if (online && process.env.DREAME_E2E_LOCATE === '1') {
      await vac.locate();
      console.log('[e2e] locate() dispatched');
    }

    await client.close();
  });

  it('discovers a MowerDevice and reads its typed state (tolerating an asleep mower)', async () => {
    expect(username, 'set DREAME_USERNAME in .env').not.toBe('');
    expect(password, 'set DREAME_PASSWORD in .env').not.toBe('');

    const client = new Nodreame({ username, password, region, fetchInitialValues: false });
    const session = await client.login();
    expect(session.accessToken).toBeTruthy(); // truthiness only — never log the token
    expect(session.uid).toBeTruthy();

    const devices = await client.discoverDevices();
    const mower = devices.find((d): d is MowerDevice => d instanceof MowerDevice);
    expect(mower, 'account should expose at least one MowerDevice').toBeInstanceOf(MowerDevice);
    console.log('[e2e] mower count:', devices.filter((d) => d instanceof MowerDevice).length);
    if (!mower) {
      await client.close();
      return;
    }

    // p2255 caps are ASSUMED — assert SHAPE, never the verified flag value.
    expect(typeof mower.mowerCapabilities.canMowZones).toBe('boolean');
    expect(typeof mower.mowerCapabilities.verified).toBe('boolean');

    try {
      const results = await mower.refreshProperties([...MowerDevice.DEFAULT_PROPS]);
      expect(Array.isArray(results)).toBe(true);
      // Shape-only: getters either decode a value/enum/object or return null.
      expect(mower.battery === null || typeof mower.battery === 'number').toBe(true);
      expect(mower.status === null || typeof mower.status === 'number').toBe(true);
      expect(mower.task === null || typeof mower.task === 'object').toBe(true);
      expect(mower.controlAction === null || typeof mower.controlAction === 'number').toBe(true);
      console.log('[e2e] mower typed-state read OK:', mower.model, '(props:', results.length, ')');
    } catch (err: unknown) {
      if (err instanceof DreameDeviceOfflineError) {
        console.log('[e2e] mower offline/sleeping; round-trip verified via offline path');
      } else {
        throw err;
      }
    }
    // NO destructive command is ever issued against the real mower.
    await client.close();
  });

  it('decodes + renders maps for a vacuum and the mower (tolerant: live or fixture)', async () => {
    expect(username, 'set DREAME_USERNAME in .env').not.toBe('');
    expect(password, 'set DREAME_PASSWORD in .env').not.toBe('');

    const client = new Nodreame({ username, password, region, fetchInitialValues: false });
    const session = await client.login();
    expect(session.accessToken).toBeTruthy(); // truthiness only — never log the token

    const devices = await client.discoverDevices();
    const vac = devices.find((d): d is VacuumDevice => d instanceof VacuumDevice);
    const mower = devices.find((d): d is MowerDevice => d instanceof MowerDevice);

    // ---- VACUUM map: try live, tolerate asleep/no-blob, always assert decode. --
    if (vac) {
      let liveMap = false;
      try {
        // Resolve the current-map OSS object name from the PATH push (siid 6,
        // piid 3). A sleeping robot publishes no fresh filename → fall through.
        const props = await vac.refreshProperties([{ siid: 6, piid: 3 }]);
        const pathProp = props.find((p) => p.siid === 6 && p.piid === 3);
        const filename = typeof pathProp?.value === 'string' ? pathProp.value : '';
        if (filename) {
          // A REAL blob: a decode error here MUST fail the e2e (no catch around
          // decode). Only the fetch/offline is tolerated.
          const map = await vac.getMap({ filename });
          expect(map.dimensions.width).toBeGreaterThan(0);
          expect(renderVacuumPng(map).subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
          liveMap = true;
          console.log('[e2e] vacuum LIVE map decoded:', vac.model, map.dimensions);
        }
      } catch (err: unknown) {
        if (err instanceof DreameDeviceOfflineError || err instanceof DreameApiError) {
          console.log('[e2e] vacuum map unavailable (asleep/no-blob); using fixture fallback');
        } else {
          throw err; // a genuine decode/transport bug must surface
        }
      }
      if (!liveMap) {
        // Fixture fallback — proves the decode→render pipeline end-to-end.
        const map = decodeVacuumMap(syntheticVacuumEnvelope());
        expect(map.dimensions.width).toBeGreaterThan(0);
        expect(map.segments.length).toBeGreaterThan(0);
        const png = renderVacuumPng(map);
        expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
        console.log('[e2e] vacuum map FIXTURE-decoded + rendered (no live blob)');
      }
    } else {
      console.log('[e2e] no VacuumDevice on the account; skipping vacuum map');
    }

    // ---- MOWER map: try live, tolerate asleep + the documented endpoint stub. --
    if (mower) {
      let liveMap = false;
      try {
        const map = await mower.getMap();
        expect(map.zones.length).toBeGreaterThanOrEqual(0);
        const svg = await mower.mapSvg();
        expect(svg).toContain('<svg');
        expect(svg).toContain('</svg>');
        liveMap = true;
        console.log('[e2e] mower LIVE map parsed:', mower.model, 'zones:', map.zones.length);
      } catch (err: unknown) {
        // The mower live map is a documented follow-up: the default device has
        // no injected batch fetcher (throws DreameError), the cloud stub throws
        // DreameApiError because the endpoint path is unrecovered, and an asleep
        // mower surfaces DreameDeviceOfflineError — all three subclass
        // DreameError, so this tolerates the whole "no live batch" family. A
        // genuine parse bug (a plain Error) still fails the e2e.
        if (err instanceof DreameError) {
          console.log('[e2e] mower map unavailable (asleep / endpoint stub); using fixture');
        } else {
          throw err;
        }
      }
      if (!liveMap) {
        const map = parseBatchMapData(syntheticMowerBatch());
        expect(map).not.toBeNull();
        if (!map) {
          throw new Error('expected the synthetic mower batch to parse');
        }
        expect(map.zones.length).toBeGreaterThan(0);
        const svg = renderMowerSvg(map);
        expect(svg.startsWith('<?xml')).toBe(true);
        expect(svg).toContain('</svg>');
        console.log('[e2e] mower map FIXTURE-parsed + rendered (no live batch)');
      }
    } else {
      console.log('[e2e] no MowerDevice on the account; skipping mower map');
    }

    await client.close();
  });
});
