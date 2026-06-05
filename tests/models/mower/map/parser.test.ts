import { describe, it, expect } from 'vitest';
// NOTE: the mower was asleep during e2e capture — these tests run against
// SYNTHETIC batch JSON fixtures constructed from the donor's expected wire
// shape (map_data_parser.py), not a guaranteed live blob. If a real batch
// capture lands it can be dropped into ./fixtures and asserted additionally.
import { parseMowerMap } from '../../../../src/models/mower/map/parser.js';
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
});
