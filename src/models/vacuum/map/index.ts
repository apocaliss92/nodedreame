/**
 * Internal barrel for the vacuum map sub-tree.
 *
 * This re-exports ONLY the public-facing pieces the device layer and the
 * top-level `src/index.ts` (Task 5.23) need to import: the structured
 * `VacuumMap` model + its sub-types, the decode/merge functions, the raster
 * renderer, the OSS blob fetcher, and the `MapDecodeError`.
 *
 * The low-level decode internals (`unwrapEnvelope`, `parseMapHeader`,
 * `parsePathTr`, `parseObstacles`, the pixel-grid/geometry/cleaned-area/tail
 * parsers, etc.) are deliberately NOT surfaced here. `src/index.ts`
 * cherry-picks from this barrel; it does not forward it wholesale. The barrel
 * exists for ergonomics within the model layer.
 */

// ── Structured model + all sub-types ──────────────────────────────────────
export type {
  MapFrameType,
  MapPathType,
  MapLayerType,
  MapPose,
  MapDimensions,
  MapBoundingBox,
  MapPoint,
  MapRun,
  MapLayer,
  MapSegment,
  MapPath,
  MapObstacle,
  MapVirtualWall,
  MapRestrictedArea,
  MapRoomWall,
  MapRoom,
  MapStorey,
  MapWallsInfo,
  MapLowLyingArea,
  MapSaved,
  MapSavedList,
  MapCleanedAreaOverlay,
  VacuumMap,
  VacuumMapDecodeOptions,
  MapTail,
  RawSegInf,
} from './types.js';

// ── Decode + I/P-frame merge ──────────────────────────────────────────────
export { decodeVacuumMap, applyVacuumPFrame } from './decode.js';

// ── Error surfaced to callers of decode/unwrap ────────────────────────────
export { MapDecodeError } from './envelope.js';

// ── Raster renderer ───────────────────────────────────────────────────────
export { renderVacuumPng } from './render.js';
export type { RenderVacuumPngOptions } from './render.js';

// ── Signed OSS blob fetcher ───────────────────────────────────────────────
export { OssFetcher } from './oss-fetch.js';
export type { OssFetchInput, OssFetcherOpts, OssFetcherLike } from './oss-fetch.js';
