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
  MowerMowPath,
  MowerAvailableMap,
  MowerPoint,
} from './types.js';

/** Sentinel pair in M_PATH data marking a path-segment break. */
const PATH_SENTINEL_X = 32767;
const PATH_SENTINEL_Y = -32768;

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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reassemble chunked data from the batch API into a single string.
 *
 * PORT of `reassemble_map_chunks`. Keys like `MAP.0`, `MAP.1`, … `MAP.N` are
 * concatenated in NUMERIC order; the `MAP.info` key (metadata) is skipped.
 * Wire values are strings; non-string values are skipped defensively.
 *
 * @param batchData raw `get_batch_device_datas` response map
 * @param prefix key prefix to match, e.g. `'MAP'` or `'M_PATH'`
 * @returns concatenated string, or `null` if no matching keys are found
 */
export function reassembleMapChunks(
  batchData: Record<string, unknown>,
  prefix: string,
): string | null {
  const pattern = new RegExp(`^${escapeRegex(prefix)}\\.(\\d+)$`);
  const chunks: Array<{ idx: number; value: string }> = [];
  for (const [key, value] of Object.entries(batchData)) {
    const match = pattern.exec(key);
    if (match && typeof value === 'string') {
      const idx = Number(match[1]);
      chunks.push({ idx, value });
    }
  }
  if (chunks.length === 0) {
    return null;
  }
  chunks.sort((a, b) => a.idx - b.idx);
  return chunks.map((c) => c.value).join('');
}

/** Parse a `MAP.info`/`M_PATH.info` digit string into a split offset (>=0). */
function parseSplitPos(info: unknown): number {
  if (typeof info === 'string' && /^\d+$/.test(info)) {
    return Number(info);
  }
  return 0;
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

/**
 * Parse `M_PATH.*` keys into mow-path traces.
 *
 * PORT of `parse_mow_paths`. Reassembles the chunks, applies the `M_PATH.info`
 * split offset, extracts every `[x,y]` pair via regex, splits on the
 * `[32767,-32768]` sentinel into segments, and scales the remaining
 * coordinates ×10 (decimeters → centimeters). Always returns at most one
 * `MowerMowPath` (zone 0), matching the donor.
 */
export function parseMowPaths(batchData: Record<string, unknown>): MowerMowPath[] {
  const reassembled = reassembleMapChunks(batchData, 'M_PATH');
  if (!reassembled) {
    return [];
  }

  const splitPos = parseSplitPos(batchData['M_PATH.info']);
  let raw = reassembled;
  if (splitPos > 0 && splitPos < raw.length) {
    raw = raw.slice(splitPos);
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed === '[]') {
    return [];
  }

  const pairPattern = /\[(-?\d+),(-?\d+)\]/g;
  const rawPairs: Array<readonly [number, number]> = [];
  for (const m of raw.matchAll(pairPattern)) {
    rawPairs.push([Number(m[1]), Number(m[2])]);
  }
  if (rawPairs.length === 0) {
    return [];
  }

  const segments: MowerPoint[][] = [];
  let current: MowerPoint[] = [];
  for (const [x, y] of rawPairs) {
    if (x === PATH_SENTINEL_X && y === PATH_SENTINEL_Y) {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
    } else {
      current.push({ x: x * 10, y: y * 10 });
    }
  }
  if (current.length > 0) {
    segments.push(current);
  }

  if (segments.length === 0) {
    return [];
  }
  return [{ zoneId: 0, segments }];
}

/** Parse one reassembled `MAP.*` part (a JSON array of map-json-strings). */
function parseMapPart(part: string): MowerMap[] {
  const trimmed = part.trim();
  if (trimmed.length === 0) {
    return [];
  }
  let arr: unknown;
  try {
    arr = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) {
    return [];
  }
  const out: MowerMap[] = [];
  for (const item of arr) {
    if (typeof item !== 'string') {
      continue;
    }
    try {
      out.push(parseMowerMap(item));
    } catch {
      // Skip malformed map entries (donor warn-and-tolerate).
    }
  }
  return out;
}

/**
 * Parse a full batch device-data response into the primary `MowerMap`.
 *
 * PORT of `parse_batch_map_data`. Reassembles `MAP.*`, splits on the
 * `MAP.info` character length, JSON-parses each part as an array of
 * map-json-strings, parses each (skipping throwers), picks the `mapIndex === 0`
 * primary (else the first), builds `availableMaps`, attaches `mowPaths`, and
 * returns the primary. Returns `null` on an empty batch or no valid arrays.
 *
 * The donor's recursive `maps: dict` cache is intentionally NOT ported — it is
 * internal HA active-map bookkeeping; we surface `availableMaps` instead.
 */
export function parseBatchMapData(batchData: Record<string, unknown>): MowerMap | null {
  if (Object.keys(batchData).length === 0) {
    return null;
  }

  const rawMap = reassembleMapChunks(batchData, 'MAP');
  if (!rawMap) {
    return null;
  }

  const splitPos = parseSplitPos(batchData['MAP.info']);
  const parts =
    splitPos > 0 && splitPos < rawMap.length
      ? [rawMap.slice(0, splitPos), rawMap.slice(splitPos)]
      : [rawMap];

  const parsedMaps: MowerMap[] = [];
  for (const part of parts) {
    parsedMaps.push(...parseMapPart(part));
  }

  if (parsedMaps.length === 0) {
    return null;
  }

  const primary = parsedMaps.find((m) => m.mapIndex === 0) ?? parsedMaps[0];
  if (!primary) {
    return null;
  }

  const availableMaps: MowerAvailableMap[] = [...parsedMaps]
    .sort((a, b) => a.mapId - b.mapId)
    .map((m) => ({
      mapId: m.mapId,
      mapIndex: m.mapIndex,
      name: m.name,
      totalArea: m.totalArea,
    }));

  const mowPaths = parseMowPaths(batchData);

  return {
    ...primary,
    availableMaps,
    mowPaths,
    currentMapId: primary.mapId,
  };
}
