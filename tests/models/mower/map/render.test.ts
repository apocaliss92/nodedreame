import { describe, it, expect } from 'vitest';
// NOTE: the mower was asleep during e2e capture — this test renders a
// SYNTHETIC MowerMap built from the donor's wire shape (map_data_parser.py)
// through the real parser, then asserts STRUCTURAL SVG content (elements +
// well-formedness), not pixel-exact bytes.
import { parseMowerMap } from '../../../../src/models/mower/map/parser.js';
import { renderMowerSvg } from '../../../../src/models/mower/map/render.js';
import type { MowerMap } from '../../../../src/models/mower/map/types.js';

/** A two-zone map + one forbidden area + one nav path, via the real parser. */
function fixtureMap(): MowerMap {
  const base = parseMowerMap(
    JSON.stringify({
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
              name: 'Front',
              type: 0,
            },
          ],
          [
            2,
            {
              path: [
                { x: 200, y: 0 },
                { x: 300, y: 0 },
                { x: 300, y: 100 },
                { x: 200, y: 100 },
              ],
              name: 'Back',
              type: 0,
            },
          ],
        ],
      },
      forbiddenAreas: {
        dataType: 'Map',
        value: [
          [
            9,
            {
              path: [
                { x: 120, y: 120 },
                { x: 160, y: 120 },
                { x: 160, y: 160 },
                { x: 120, y: 160 },
              ],
              name: 'Pond',
              type: 1,
            },
          ],
        ],
      },
      paths: {
        dataType: 'Map',
        value: [
          [
            7,
            {
              path: [
                { x: 100, y: 50 },
                { x: 200, y: 50 },
              ],
              type: 1,
            },
          ],
        ],
      },
      mapIndex: 0,
      name: 'Garden',
    }),
  );
  // attach a mow-path track (two points) for zone 0
  return {
    ...base,
    mowPaths: [
      {
        zoneId: 0,
        segments: [
          [
            { x: 10, y: 10 },
            { x: 90, y: 90 },
          ],
        ],
      },
    ],
  };
}

const EMPTY_MAP: MowerMap = {
  zones: [],
  spotAreas: [],
  forbiddenAreas: [],
  paths: [],
  contours: [],
  boundary: null,
  totalArea: 0,
  name: '',
  mapId: 1,
  mapIndex: 0,
  mowPaths: [],
  availableMaps: [],
  currentMapId: null,
  lastUpdated: null,
};

describe('renderMowerSvg', () => {
  it('emits a well-formed SVG document', () => {
    const svg = renderMowerSvg(fixtureMap());
    expect(svg.startsWith('<?xml')).toBe(true);
    expect(svg).toContain('<svg');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('renders one <polygon> per zone + one per forbidden area', () => {
    const map = fixtureMap();
    const svg = renderMowerSvg(map);
    const polygons = svg.match(/<polygon /g) ?? [];
    expect(polygons.length).toBe(map.zones.length + map.forbiddenAreas.length);
  });

  it('renders nav paths and mow-path tracks as <path>', () => {
    const svg = renderMowerSvg(fixtureMap());
    expect(svg).toContain('<path ');
  });

  it('respects custom dimensions', () => {
    const svg = renderMowerSvg(fixtureMap(), { width: 640, height: 480 });
    expect(svg).toContain('width="640"');
    expect(svg).toContain('height="480"');
  });

  it('renders a well-formed fallback SVG for an empty map', () => {
    const svg = renderMowerSvg(EMPTY_MAP);
    expect(svg.startsWith('<?xml')).toBe(true);
    expect(svg).toContain('No map data available');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    expect(svg.match(/<polygon /g)).toBeNull();
  });
});
