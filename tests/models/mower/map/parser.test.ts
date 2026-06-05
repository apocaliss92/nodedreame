import { describe, it, expect } from 'vitest';
// NOTE: the mower was asleep during e2e capture — these tests run against
// SYNTHETIC batch JSON fixtures constructed from the donor's expected wire
// shape (map_data_parser.py), not a guaranteed live blob. If a real batch
// capture lands it can be dropped into ./fixtures and asserted additionally.
import {
  parseMowerMap,
  reassembleMapChunks,
  extractContourId,
  parseMowPaths,
  parseBatchMapData,
} from '../../../../src/models/mower/map/parser.js';
import type { MowerMap } from '../../../../src/models/mower/map/types.js';

/** A single mowing-area map with one polygon zone (donor wire shape). */
function singleZoneMapJson(): string {
  return JSON.stringify({
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
    totalArea: 10000,
    name: 'Garden',
    mapIndex: 0,
  });
}

describe('parseMowerMap (single zone)', () => {
  it('parses a minimal single-zone map into a structured MowerMap', () => {
    const map: MowerMap = parseMowerMap(singleZoneMapJson());
    expect(map.zones).toHaveLength(1);
    const zone = map.zones[0];
    expect(zone).toBeDefined();
    if (!zone) {
      throw new Error('expected a zone');
    }
    expect(zone.zoneId).toBe(1);
    expect(zone.name).toBe('Front Lawn');
    expect(zone.zoneType).toBe(2);
    expect(zone.shapeType).toBe(1);
    expect(zone.area).toBe(10000);
    expect(zone.time).toBe(5);
    expect(zone.etime).toBe(9);
    expect(zone.path).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
    expect(map.name).toBe('Garden');
    expect(map.totalArea).toBe(10000);
    expect(map.mapIndex).toBe(0);
    // map_id_from_index: index + 1
    expect(map.mapId).toBe(1);
    expect(map.boundary).toEqual({ x1: -10, y1: -10, x2: 110, y2: 110 });
    expect(map.lastUpdated).not.toBeNull();
  });

  it('parses spotAreas, forbiddenAreas, paths and contours', () => {
    const json = JSON.stringify({
      mowingAreas: { dataType: 'Map', value: [] },
      spotAreas: {
        dataType: 'Map',
        value: [[5, { path: [{ x: 1, y: 2 }], name: 'Bed', shapeType: 0, area: 3 }]],
      },
      forbiddenAreas: {
        dataType: 'Map',
        value: [[9, { path: [{ x: 7, y: 8 }], name: 'Pond', type: 1 }]],
      },
      paths: {
        dataType: 'Map',
        value: [
          [
            2,
            {
              path: [
                { x: 0, y: 0 },
                { x: 5, y: 5 },
              ],
              type: 1,
            },
          ],
        ],
      },
      contours: {
        dataType: 'Map',
        value: [['1,0', { path: [{ x: 9, y: 9 }], type: 4, shapeType: 2 }]],
      },
      mapIndex: 0,
    });
    const map = parseMowerMap(json);
    expect(map.spotAreas).toEqual([
      { areaId: 5, path: [{ x: 1, y: 2 }], name: 'Bed', shapeType: 0, area: 3 },
    ]);
    expect(map.forbiddenAreas).toEqual([
      {
        zoneId: 9,
        path: [{ x: 7, y: 8 }],
        name: 'Pond',
        zoneType: 1,
        shapeType: 0,
        area: 0,
        time: 0,
        etime: 0,
      },
    ]);
    expect(map.paths).toEqual([
      {
        pathId: 2,
        path: [
          { x: 0, y: 0 },
          { x: 5, y: 5 },
        ],
        pathType: 1,
      },
    ]);
    expect(map.contours).toEqual([
      { contourId: [1, 0], path: [{ x: 9, y: 9 }], contourType: 4, shapeType: 2 },
    ]);
  });

  it('returns empty lists when a block is not a dataType:Map', () => {
    const map = parseMowerMap(JSON.stringify({ mowingAreas: { dataType: 'Other' }, mapIndex: 0 }));
    expect(map.zones).toEqual([]);
    expect(map.boundary).toBeNull();
  });
});

describe('reassembleMapChunks', () => {
  it('concatenates numbered chunks in numeric order, skipping .info', () => {
    const batch = { 'MAP.0': '[{"x', 'MAP.1': '":1}]', 'MAP.info': '5' };
    expect(reassembleMapChunks(batch, 'MAP')).toBe('[{"x":1}]');
  });

  it('sorts numerically (10 after 2), not lexically', () => {
    const batch = { 'MAP.2': 'b', 'MAP.10': 'd', 'MAP.0': 'a', 'MAP.1': 'c' };
    expect(reassembleMapChunks(batch, 'MAP')).toBe('acbd');
  });

  it('returns null when no matching keys exist', () => {
    expect(reassembleMapChunks({ 'OTHER.0': 'x' }, 'MAP')).toBeNull();
    expect(reassembleMapChunks({}, 'MAP')).toBeNull();
  });

  it('skips non-string chunk values defensively', () => {
    const batch = { 'MAP.0': 'ok', 'MAP.1': 123 };
    expect(reassembleMapChunks(batch, 'MAP')).toBe('ok');
  });
});

describe('extractContourId', () => {
  it('accepts a comma string and a two-element array', () => {
    expect(extractContourId('1,0')).toEqual([1, 0]);
    expect(extractContourId([1, 0])).toEqual([1, 0]);
    expect(extractContourId(' 3 , 4 ')).toEqual([3, 4]);
  });

  it('throws on an invalid length / shape', () => {
    expect(() => extractContourId('1,2,3')).toThrow(/Invalid contour id/);
    expect(() => extractContourId([1])).toThrow(/Invalid contour id/);
    expect(() => extractContourId(42)).toThrow(/Invalid contour id/);
  });
});

describe('parseMowPaths', () => {
  it('splits on the sentinel and scales coords by 10', () => {
    const batch = { 'M_PATH.0': '[[1,2],[32767,-32768],[3,4]]', 'M_PATH.info': '0' };
    const paths = parseMowPaths(batch);
    expect(paths).toHaveLength(1);
    const mp = paths[0];
    expect(mp).toBeDefined();
    if (!mp) {
      throw new Error('expected a mow path');
    }
    expect(mp.zoneId).toBe(0);
    expect(mp.segments).toEqual([[{ x: 10, y: 20 }], [{ x: 30, y: 40 }]]);
  });

  it('honours the M_PATH.info split offset', () => {
    // First 8 chars are junk dropped by the offset; remaining is one pair.
    const batch = { 'M_PATH.0': 'XXXXXXXX[[5,6]]', 'M_PATH.info': '8' };
    const paths = parseMowPaths(batch);
    expect(paths).toEqual([{ zoneId: 0, segments: [[{ x: 50, y: 60 }]] }]);
  });

  it('returns [] for no keys / empty / [] payloads', () => {
    expect(parseMowPaths({})).toEqual([]);
    expect(parseMowPaths({ 'M_PATH.0': '[]' })).toEqual([]);
    expect(parseMowPaths({ 'M_PATH.0': '   ' })).toEqual([]);
  });
});

describe('parseBatchMapData', () => {
  it('reassembles, parses the primary (mapIndex 0) and attaches maps + mow paths', () => {
    const mapA = JSON.stringify({
      name: 'A',
      mapIndex: 0,
      totalArea: 11,
      mowingAreas: { dataType: 'Map', value: [] },
    });
    const mapB = JSON.stringify({
      name: 'B',
      mapIndex: 1,
      totalArea: 22,
      mowingAreas: { dataType: 'Map', value: [] },
    });
    // MAP.* is a JSON array of map-json-strings. MAP.info splits two arrays.
    const arrA = JSON.stringify([mapA]);
    const arrB = JSON.stringify([mapB]);
    const reassembled = arrA + arrB;
    const batch = {
      'MAP.0': reassembled,
      'MAP.info': String(arrA.length),
      'M_PATH.0': '[[1,1],[2,2]]',
      'M_PATH.info': '0',
    };
    const map = parseBatchMapData(batch);
    expect(map).not.toBeNull();
    if (!map) {
      throw new Error('expected a map');
    }
    expect(map.name).toBe('A');
    expect(map.mapIndex).toBe(0);
    expect(map.mapId).toBe(1);
    expect(map.availableMaps).toEqual([
      { mapId: 1, mapIndex: 0, name: 'A', totalArea: 11 },
      { mapId: 2, mapIndex: 1, name: 'B', totalArea: 22 },
    ]);
    expect(map.mowPaths).toEqual([
      {
        zoneId: 0,
        segments: [
          [
            { x: 10, y: 10 },
            { x: 20, y: 20 },
          ],
        ],
      },
    ]);
  });

  it('returns null on empty / missing batch data', () => {
    expect(parseBatchMapData({})).toBeNull();
    expect(parseBatchMapData({ 'OTHER.0': 'x' })).toBeNull();
  });

  it('skips malformed map entries without crashing', () => {
    const good = JSON.stringify({
      name: 'Good',
      mapIndex: 0,
      mowingAreas: { dataType: 'Map', value: [] },
    });
    const arr = JSON.stringify(['{ not json', good]);
    const batch = { 'MAP.0': arr };
    const map = parseBatchMapData(batch);
    expect(map).not.toBeNull();
    expect(map?.name).toBe('Good');
  });

  it('falls back to the first entry when no mapIndex 0 exists', () => {
    const only = JSON.stringify({
      name: 'Solo',
      mapIndex: 3,
      mowingAreas: { dataType: 'Map', value: [] },
    });
    const arr = JSON.stringify([only]);
    const map = parseBatchMapData({ 'MAP.0': arr });
    expect(map?.name).toBe('Solo');
    expect(map?.mapIndex).toBe(3);
  });

  it('returns null when MAP.* reassembles but no part yields a parseable map', () => {
    // rawMap is non-null (a present, non-empty chunk), but the payload is a
    // JSON array whose ONLY element is an unparseable map-json string — every
    // entry throws and is skipped → parsedMaps is empty → null.
    const arr = JSON.stringify(['{ not valid json']);
    expect(parseBatchMapData({ 'MAP.0': arr })).toBeNull();
  });

  it('returns null when MAP.* reassembles to a non-array JSON value', () => {
    // rawMap is non-null but parses to an object, not an array of strings →
    // parseMapPart returns [] → parsedMaps empty → null.
    expect(parseBatchMapData({ 'MAP.0': '{"not":"an array"}' })).toBeNull();
  });
});
