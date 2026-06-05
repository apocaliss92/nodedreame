/**
 * Internal barrel for the mower map sub-tree.
 *
 * Re-exports the public-facing pieces the device layer and the top-level
 * `src/index.ts` (Task 5.23) need to import: the structured `MowerMap` model +
 * its sub-types, the batch-data parser, and the SVG renderer. The chunk
 * reassembly / single-map / mow-path / contour-id helpers are surfaced too for
 * device-layer ergonomics; `src/index.ts` cherry-picks from this barrel rather
 * than forwarding it wholesale. Internal-only ergonomics.
 */

// ── Structured model + all sub-types ──────────────────────────────────────
export type {
  MowerPoint,
  MowerZone,
  MowerSpotArea,
  MowerPathEntry,
  MowerContour,
  MowerMapBoundary,
  MowerMowPath,
  MowerAvailableMap,
  MowerMap,
} from './types.js';

// ── Batch parser + helpers ────────────────────────────────────────────────
export {
  parseBatchMapData,
  parseMowerMap,
  parseMowPaths,
  reassembleMapChunks,
  extractContourId,
} from './parser.js';

// ── SVG renderer ──────────────────────────────────────────────────────────
export { renderMowerSvg } from './render.js';
export type { RenderMowerSvgOptions } from './render.js';
