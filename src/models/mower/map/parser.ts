/**
 * Parser for mower vector map data from the Dreame batch device-data API.
 *
 * PORT of antondaubert/dreame-mower's `map_data_parser.py`. The batch API
 * returns map data split across numbered keys (`MAP.0`, `MAP.1`, …); these
 * chunks are concatenated in numeric order to form a complete JSON string. The
 * JSON carries polygon-based zone boundaries, navigation paths, contours and
 * metadata. `M_PATH.*` keys carry the mow-path trace the same chunked way.
 *
 * Wire values arrive as `unknown`; every shape is narrowed with type-guards
 * (no `as` casts). Malformed entries are skipped (warn-and-tolerate), mirroring
 * the donor's try/except. The Python `vector_map_to_map_data` bridge and the
 * internal recursive `maps: dict` cache are intentionally NOT ported — the SVG
 * renderer consumes the structured `MowerMap` directly.
 */
import type {
  MowerMap,
  MowerZone,
  MowerSpotArea,
  MowerPathEntry,
  MowerContour,
  MowerMapBoundary,
  MowerPoint,
} from './types.js';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function asString(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

/** Translate the batch map index into the task-level region identifier. */
function mapIdFromIndex(mapIndex: number): number {
  return mapIndex + 1;
}

/**
 * Extract the `value` array from a `{ dataType: 'Map', value: [...] }` block.
 * Returns `[]` unless the block is a Map with an array value, mirroring the
 * donor `_parse_polygon_list`.
 */
function parsePolygonList(dataMap: unknown): readonly unknown[] {
  if (!isRecord(dataMap) || dataMap['dataType'] !== 'Map') {
    return [];
  }
  const value = dataMap['value'];
  return Array.isArray(value) ? value : [];
}

/** Convert `[{ x, y }, …]` wire points to `MowerPoint[]`, skipping malformed. */
function extractPathCoords(pathList: unknown): MowerPoint[] {
  if (!Array.isArray(pathList)) {
    return [];
  }
  const out: MowerPoint[] = [];
  for (const p of pathList) {
    if (isRecord(p) && typeof p['x'] === 'number' && typeof p['y'] === 'number') {
      out.push({ x: p['x'], y: p['y'] });
    }
  }
  return out;
}

/**
 * Normalize a contour identifier (string `'1,0'` or two-element array) into a
 * two-integer tuple. Throws on an invalid length — caught by the batch parser.
 */
export function extractContourId(raw: unknown): readonly [number, number] {
  if (typeof raw === 'string') {
    const parts = raw.split(',').map((part) => part.trim());
    if (parts.length !== 2) {
      throw new Error(`Invalid contour id: ${raw}`);
    }
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      throw new Error(`Invalid contour id: ${raw}`);
    }
    return [Math.trunc(a), Math.trunc(b)];
  }
  if (Array.isArray(raw) && raw.length === 2) {
    const pair: readonly unknown[] = raw;
    const a = pair[0];
    const b = pair[1];
    if (typeof a === 'number' && typeof b === 'number') {
      return [Math.trunc(a), Math.trunc(b)];
    }
  }
  throw new Error(`Invalid contour id: ${JSON.stringify(raw)}`);
}

/** A `[id, data]` polygon entry on the wire. */
function asEntry(entry: unknown): { id: unknown; data: Record<string, unknown> } | null {
  if (!Array.isArray(entry) || entry.length < 2) {
    return null;
  }
  const tuple: readonly unknown[] = entry;
  const data = tuple[1];
  if (!isRecord(data)) {
    return null;
  }
  return { id: tuple[0], data };
}

function parseZones(list: readonly unknown[], includeTimes: boolean): MowerZone[] {
  const out: MowerZone[] = [];
  for (const raw of list) {
    const entry = asEntry(raw);
    if (!entry) {
      continue;
    }
    const { id, data } = entry;
    out.push({
      zoneId: asNumber(id, 0),
      path: extractPathCoords(data['path']),
      name: asString(data['name'], ''),
      zoneType: asNumber(data['type'], 0),
      shapeType: includeTimes ? asNumber(data['shapeType'], 0) : 0,
      area: includeTimes ? asNumber(data['area'], 0) : 0,
      time: includeTimes ? asNumber(data['time'], 0) : 0,
      etime: includeTimes ? asNumber(data['etime'], 0) : 0,
    });
  }
  return out;
}

function parseSpotAreas(list: readonly unknown[]): MowerSpotArea[] {
  const out: MowerSpotArea[] = [];
  for (const raw of list) {
    const entry = asEntry(raw);
    if (!entry) {
      continue;
    }
    const { id, data } = entry;
    out.push({
      areaId: Math.trunc(asNumber(id, 0)),
      path: extractPathCoords(data['path']),
      name: asString(data['name'], ''),
      shapeType: asNumber(data['shapeType'], 0),
      area: asNumber(data['area'], 0),
    });
  }
  return out;
}

function parsePaths(list: readonly unknown[]): MowerPathEntry[] {
  const out: MowerPathEntry[] = [];
  for (const raw of list) {
    const entry = asEntry(raw);
    if (!entry) {
      continue;
    }
    const { id, data } = entry;
    out.push({
      pathId: asNumber(id, 0),
      path: extractPathCoords(data['path']),
      pathType: asNumber(data['type'], 0),
    });
  }
  return out;
}

function parseContours(list: readonly unknown[]): MowerContour[] {
  const out: MowerContour[] = [];
  for (const raw of list) {
    const entry = asEntry(raw);
    if (!entry) {
      continue;
    }
    const { id, data } = entry;
    out.push({
      contourId: extractContourId(id),
      path: extractPathCoords(data['path']),
      contourType: asNumber(data['type'], 0),
      shapeType: asNumber(data['shapeType'], 0),
    });
  }
  return out;
}

function parseBoundary(raw: unknown): MowerMapBoundary | null {
  if (!isRecord(raw)) {
    return null;
  }
  const { x1, y1, x2, y2 } = raw;
  if (
    typeof x1 !== 'number' ||
    typeof y1 !== 'number' ||
    typeof x2 !== 'number' ||
    typeof y2 !== 'number'
  ) {
    return null;
  }
  return { x1, y1, x2, y2 };
}

/**
 * Parse a single map JSON string into a `MowerMap`.
 *
 * PORT of `parse_mower_map`. `JSON.parse` may throw on malformed input and
 * `extractContourId` may throw on an invalid contour id — both bubble up to
 * `parseBatchMapData`, which catches and skips (the donor's try/except).
 */
export function parseMowerMap(mapJsonStr: string): MowerMap {
  const data: unknown = JSON.parse(mapJsonStr);
  if (!isRecord(data)) {
    throw new Error('Map JSON is not an object');
  }

  const mapIndex = asNumber(data['mapIndex'], 0);

  return {
    zones: parseZones(parsePolygonList(data['mowingAreas']), true),
    spotAreas: parseSpotAreas(parsePolygonList(data['spotAreas'])),
    forbiddenAreas: parseZones(parsePolygonList(data['forbiddenAreas']), false),
    paths: parsePaths(parsePolygonList(data['paths'])),
    contours: parseContours(parsePolygonList(data['contours'])),
    boundary: parseBoundary(data['boundary']),
    totalArea: asNumber(data['totalArea'], 0),
    name: asString(data['name'], ''),
    mapIndex,
    mapId: mapIdFromIndex(mapIndex),
    mowPaths: [],
    availableMaps: [],
    currentMapId: null,
    lastUpdated: Date.now(),
  };
}
