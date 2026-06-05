import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as api from '../src/index.js';

describe('public API surface (P1)', () => {
  it('still exports LIBRARY_NAME', () => {
    expect(api.LIBRARY_NAME).toBe('nodedreame');
  });

  it('exports the error classes', () => {
    expect(typeof api.DreameError).toBe('function');
    expect(typeof api.DreameAuthError).toBe('function');
    expect(typeof api.DreameApiError).toBe('function');
    expect(typeof api.DreameDeviceOfflineError).toBe('function');
    expect(typeof api.DreameTransportError).toBe('function');
  });
});

describe('public API surface (P2)', () => {
  it('exports the Nodreame facade', () => {
    expect(typeof api.Nodreame).toBe('function');
  });

  it('exports the BaseDevice handle', () => {
    expect(typeof api.BaseDevice).toBe('function');
  });

  it('exports the capability scaffold', () => {
    expect(typeof api.DefaultCapabilityResolver).toBe('function');
    expect(typeof api.resolveCapabilities).toBe('function');
  });

  it('does NOT leak transport internals (DreamePush is private)', () => {
    expect('DreamePush' in api).toBe(false);
  });
});

describe('public API surface (P3)', () => {
  it('exports VacuumDevice', () => {
    expect(typeof api.VacuumDevice).toBe('function');
  });

  it('exports the vacuum enums', () => {
    expect(api.SuctionLevel.Max).toBe(3);
    expect(api.WaterVolume.High).toBe(3);
    expect(api.CleaningMode.SweepAndMop).toBe(2);
    expect(api.MiotState.Charging).toBe(6);
    expect(typeof api.MiotError).toBe('object');
    expect(typeof api.TaskStatus).toBe('object');
    expect(typeof api.ChargingStatus).toBe('object');
  });

  it('exports the vacuum capability helpers', () => {
    expect(typeof api.getVacuumCapabilities).toBe('function');
    expect(typeof api.VacuumCapabilityResolver).toBe('function');
    expect(typeof api.VACUUM_MODEL_CAPABILITIES).toBe('object');
  });

  it('does NOT leak vacuum internals (property maps / decode helpers / factory stay private)', () => {
    expect('VACUUM_PROP' in api).toBe(false);
    expect('VACUUM_ACTION' in api).toBe(false);
    expect('parseFaultList' in api).toBe(false);
    expect('enumMembers' in api).toBe(false);
    expect('deviceClassFor' in api).toBe(false);
  });
});

describe('public API surface (P4)', () => {
  it('exports MowerDevice', () => {
    expect(typeof api.MowerDevice).toBe('function');
  });

  it('exports the mower enums', () => {
    expect(api.MowerStatus.Mowing).toBe(1);
    expect(api.MowerChargingStatus.Charging).toBe(1);
    expect(api.MowerControlAction.Pause).toBe(4);
    expect(typeof api.MowerTaskStatus).toBe('object');
  });

  it('exports the mower capability helpers', () => {
    expect(typeof api.getMowerCapabilities).toBe('function');
    expect(typeof api.MowerCapabilityResolver).toBe('function');
    expect(typeof api.MOWER_MODEL_CAPABILITIES).toBe('object');
  });

  it('does NOT leak mower internals (property maps / decode / opcode builders stay private)', () => {
    expect('MOWER_PROP' in api).toBe(false);
    expect('MOWER_ACTION' in api).toBe(false);
    expect('MOWER_EVENT' in api).toBe(false);
    expect('TASK_OPCODE' in api).toBe(false);
    expect('buildResumePayload' in api).toBe(false);
    expect('buildAllAreaPayload' in api).toBe(false);
    expect('buildZonePayload' in api).toBe(false);
    expect('buildEdgePayload' in api).toBe(false);
    expect('buildSpotPayload' in api).toBe(false);
    expect('parseTaskDescriptor' in api).toBe(false);
    expect('parseControlStatus' in api).toBe(false);
    expect('controlActionFor' in api).toBe(false);
    expect('deviceClassFor' in api).toBe(false);
  });
});

describe('public API surface (P5 maps)', () => {
  it('exports the vacuum map renderer', () => {
    // VacuumMap and its sub-types are type-only exports (no runtime value); the
    // renderer is the only runtime-value map export on the vacuum side. The
    // decoder is intentionally NOT public — consumers obtain maps via
    // VacuumDevice.getMap().
    expect(typeof api.renderVacuumPng).toBe('function');
  });

  it('exports the mower map renderer', () => {
    expect(typeof api.renderMowerSvg).toBe('function');
  });

  it('exposes maps via the already-exported device handles, not free functions', () => {
    // getMap/mapSvg/currentSegmentId/lastMap are instance members reachable
    // through VacuumDevice/MowerDevice — confirm those handles are present.
    expect(typeof api.VacuumDevice).toBe('function');
    expect(typeof api.MowerDevice).toBe('function');
  });

  it('does NOT leak vacuum map decode internals', () => {
    for (const k of [
      'unwrapEnvelope',
      'parseMapHeader',
      'parseFrame',
      'sliceTailText',
      'parseMapJsonTail',
      'parseFloatField',
      'parseIntField',
      'decodePixelGridFsm1',
      'collectSegments',
      'classifyPixelFsm1',
      'safeBase64ToUtf8',
      'parsePathTr',
      'parseObstacles',
      'parseVirtualWalls',
      'parseRestrictedArea',
      'parseWallsInfo',
      'parseLowLyingAreas',
      'parseTailGeometry',
      'isGeometryComplete',
      'coalesceGeometry',
      'parseCleanedAreaOverlay',
      'decodeCleanedAreaPixels',
      'mergePFrame',
      'mergePFrameEnvelope',
      'MapDecoder',
      'OssFetcher',
      'decodeVacuumMap',
      'applyVacuumPFrame',
      'MapDecodeError',
    ]) {
      expect(k in api).toBe(false);
    }
  });

  it('does NOT leak mower map parser internals', () => {
    for (const k of [
      'parseBatchMapData',
      'reassembleMapChunks',
      'parseMowerMap',
      'parseMowPaths',
      'extractContourId',
      'getBatchDeviceDatas',
    ]) {
      expect(k in api).toBe(false);
    }
  });
});

describe('public API surface (fetcher-injection types)', () => {
  // These are type-only exports (no runtime value). We verify them against
  // src/index.ts so the test passes without requiring a prior `npm run build`.
  const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');

  it('exports the vacuum getMap fetcher-injection types', () => {
    // Each name must appear in an `export type { ... }` block in src/index.ts.
    expect(src).toMatch(/export\s+type\s+\{[^}]*\bVacuumGetMapInput\b/s);
    expect(src).toMatch(/export\s+type\s+\{[^}]*\bOssFetcherLike\b/s);
    expect(src).toMatch(/export\s+type\s+\{[^}]*\bOssFetchInput\b/s);
  });

  it('exports the mower getMap batch-fetch seam types', () => {
    expect(src).toMatch(/export\s+type\s+\{[^}]*\bBatchDeviceDataFetcher\b/s);
    expect(src).toMatch(/export\s+type\s+\{[^}]*\bMowerDeviceInput\b/s);
  });

  it('does NOT export the concrete OssFetcher class', () => {
    // Runtime check: OssFetcher must not be a value export.
    expect('OssFetcher' in api).toBe(false);
    // Source check: no `export { OssFetcher` or `export { ..., OssFetcher` line
    // (bare value export). `OssFetcherLike`/`OssFetchInput` and JSDoc mentions
    // are fine; only a value-export line is banned.
    expect(src).not.toMatch(/export\s+\{[^}]*\bOssFetcher\b(?!Like|Input)[^}]*\}/s);
    // Sanity: the interface IS exported as a type.
    expect(src).toMatch(/export\s+type\s+\{[^}]*\bOssFetcherLike\b/s);
  });
});
