/**
 * Structured model for the mower vector map.
 *
 * PORT of the `@dataclass` definitions in antondaubert/dreame-mower's
 * `map_data_parser.py` (`MowerZone`, `MowerPath`, `MowerContour`,
 * `MowerSpotArea`, `MowerAvailableMap`, `MowerMapBoundary`, `MowerMowPath`,
 * `MowerVectorMap`) re-typed as TypeScript interfaces with camelCase fields.
 *
 * Defaults are applied by the parser (Task 5.15), NOT by the type. Coordinate
 * points are kept as `{ x, y }` objects (not tuples) to mirror the vacuum
 * map's `MapPoint` and keep the public API ergonomic; the parser converts the
 * wire `{ x, y }` shape directly.
 */

/** A single coordinate point in mower map units. */
export interface MowerPoint {
  x: number;
  y: number;
}

/** A mowing zone defined by a polygon boundary. */
export interface MowerZone {
  zoneId: number;
  path: readonly MowerPoint[];
  name: string;
  zoneType: number;
  shapeType: number;
  area: number;
  time: number;
  etime: number;
}

/** A spot-mowing area defined by a polygon boundary. */
export interface MowerSpotArea {
  areaId: number;
  path: readonly MowerPoint[];
  name: string;
  shapeType: number;
  area: number;
}

/** A navigation path between zones. */
export interface MowerPathEntry {
  pathId: number;
  path: readonly MowerPoint[];
  pathType: number;
}

/** A contour entry used for boundary or edge mowing. */
export interface MowerContour {
  contourId: readonly [number, number];
  path: readonly MowerPoint[];
  contourType: number;
  shapeType: number;
}

/** Bounding box for the entire map. */
export interface MowerMapBoundary {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Mowing-path trace — the actual trail the mower followed. */
export interface MowerMowPath {
  zoneId: number;
  segments: readonly (readonly MowerPoint[])[];
}

/** A discovered map that can be targeted by map-aware mowing tasks. */
export interface MowerAvailableMap {
  mapId: number;
  mapIndex: number;
  name: string;
  totalArea: number;
}

/** Complete vector map data for a mower, parsed from the batch API. */
export interface MowerMap {
  zones: readonly MowerZone[];
  spotAreas: readonly MowerSpotArea[];
  forbiddenAreas: readonly MowerZone[];
  paths: readonly MowerPathEntry[];
  contours: readonly MowerContour[];
  boundary: MowerMapBoundary | null;
  totalArea: number;
  name: string;
  mapId: number;
  mapIndex: number;
  mowPaths: readonly MowerMowPath[];
  availableMaps: readonly MowerAvailableMap[];
  currentMapId: number | null;
  lastUpdated: number | null;
}
