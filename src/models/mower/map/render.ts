/**
 * Deterministic SVG renderer for a structured `MowerMap`.
 *
 * ADAPT of antondaubert/dreame-mower's `svg_map_generator.py` — only the
 * geometry path is kept. We port `calculate_bounds`, `coord_to_pixel`
 * (aspect-preserving, Y-flipped, centred), `svg_polygon` (≥3 points),
 * `svg_path_from_segments` (M/L with consecutive-pixel dedupe), and the
 * `create_svg_document`/`finish_svg_document` framing.
 *
 * The HA-coordinator-coupled chrome (legend, status overlay, timestamp, title,
 * historical-file handling, rotation-from-coordinator, live-tracking overlay,
 * mower-position circle) is DROPPED — it depends on a `coordinator`, a file
 * path and live device state we don't carry. The renderer takes only a
 * `MowerMap` + optional `{ width, height, padding }`.
 *
 * Zone `name`s are NOT rendered as text in v1 (keeps the output injection-safe
 * and minimal — no untrusted strings reach the SVG). Pure string building, no
 * deps, cast-free.
 */
import type { MowerMap, MowerPoint } from './types.js';

export interface RenderMowerSvgOptions {
  /** Canvas width in pixels. Default 1200. */
  width?: number;
  /** Canvas height in pixels. Default 1200. */
  height?: number;
  /** Padding around the map content in pixels. Default 50. */
  padding?: number;
}

const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 1200;
const DEFAULT_PADDING = 50;

const BACKGROUND = '#f5f5f0';
const MAP_BOUNDARY = '#006400';
const MOWING_PATH = '#ffa500';
const NAV_PATH = '#b4b4b4';
const OBSTACLE_STROKE = '#ff4d00';
const OBSTACLE_FILL = '#ff4d0065';
const TEXT_COLOR = '#000000';

/** Zone fill/outline palette — soft pastels matching the Dreame app. */
const ZONE_COLORS: ReadonlyArray<readonly [string, string]> = [
  ['#a4d291c8', '#86be73'],
  ['#a0c8dcc8', '#82aac8'],
  ['#f0c8aac8', '#dcaf8c'],
  ['#f0b4b4c8', '#dc9696'],
  ['#e6dca0c8', '#d2c882'],
  ['#beaadcc8', '#aa91c8'],
  ['#aad7d2c8', '#8cc3be'],
  ['#dcbea0c8', '#c8a582'],
];

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Sentinel coordinate value used as a path-segment break in the donor. */
const SENTINEL = 2147483647;

/** Compute the bounding box for all points, ignoring sentinels. */
function calculateBounds(allPoints: readonly MowerPoint[]): Bounds {
  const valid = allPoints.filter((p) => p.x !== SENTINEL && p.y !== SENTINEL);
  if (valid.length === 0) {
    return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  }
  let minX = valid[0]?.x ?? 0;
  let maxX = minX;
  let minY = valid[0]?.y ?? 0;
  let maxY = minY;
  for (const p of valid) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

interface Pixel {
  px: number;
  py: number;
}

/**
 * Convert mower coordinates to image pixel coordinates: aspect-preserving
 * (smaller scale wins), centred in the available space, Y-flipped so the map
 * origin sits at the bottom-left.
 */
function coordToPixel(
  point: MowerPoint,
  bounds: Bounds,
  width: number,
  height: number,
  padding: number,
): Pixel {
  let { maxX, maxY } = bounds;
  const { minX, minY } = bounds;
  if (maxX === minX) {
    maxX = minX + 100;
  }
  if (maxY === minY) {
    maxY = minY + 100;
  }
  const coordWidth = maxX - minX;
  const coordHeight = maxY - minY;
  const availableWidth = width - 2 * padding;
  const availableHeight = height - 2 * padding;
  const scale = Math.min(availableWidth / coordWidth, availableHeight / coordHeight);
  const renderedWidth = coordWidth * scale;
  const renderedHeight = coordHeight * scale;
  const offsetX = padding + (availableWidth - renderedWidth) / 2;
  const offsetY = padding + (availableHeight - renderedHeight) / 2;
  const px = Math.trunc(offsetX + (point.x - minX) * scale);
  const py = Math.trunc(offsetY + (maxY - point.y) * scale);
  return { px, py };
}

/** SVG `<polygon>` for ≥3 points; `''` otherwise. */
function svgPolygon(
  points: readonly MowerPoint[],
  bounds: Bounds,
  width: number,
  height: number,
  padding: number,
  fill: string,
  stroke: string,
): string {
  if (points.length < 3) {
    return '';
  }
  const pixels = points
    .map((p) => coordToPixel(p, bounds, width, height, padding))
    .map((p) => `${p.px},${p.py}`)
    .join(' ');
  return `<polygon points="${pixels}" fill="${fill}" stroke="${stroke}"/>`;
}

/**
 * SVG `<path>` (M/L) built from one or more segments, skipping consecutive
 * duplicate pixels and segments shorter than two points. `''` when nothing
 * renders.
 */
function svgPathFromSegments(
  segments: readonly (readonly MowerPoint[])[],
  bounds: Bounds,
  width: number,
  height: number,
  padding: number,
  stroke: string,
  strokeWidth: number,
  dashed: boolean,
): string {
  const parts: string[] = [];
  for (const segment of segments) {
    if (segment.length < 2) {
      continue;
    }
    const first = segment[0];
    if (!first) {
      continue;
    }
    let prev = coordToPixel(first, bounds, width, height, padding);
    parts.push(`M ${prev.px} ${prev.py}`);
    for (let i = 1; i < segment.length; i += 1) {
      const point = segment[i];
      if (!point) {
        continue;
      }
      const pixel = coordToPixel(point, bounds, width, height, padding);
      if (pixel.px !== prev.px || pixel.py !== prev.py) {
        parts.push(`L ${pixel.px} ${pixel.py}`);
        prev = pixel;
      }
    }
  }
  if (parts.length === 0) {
    return '';
  }
  const dash = dashed ? ' stroke-dasharray="10,5"' : '';
  return `<path d="${parts.join(' ')}" stroke="${stroke}" stroke-width="${strokeWidth}"${dash} fill="none"/>`;
}

/**
 * Render a `MowerMap` into a deterministic SVG document string.
 *
 * Draw order (back to front): background, nav paths (dashed grey), zone fills
 * (per-zone pastel), zone outlines, mow-path tracks (orange), forbidden-area
 * polygons (red). An empty map renders a centred "No map data available"
 * fallback inside a closed `<svg>`.
 */
export function renderMowerSvg(map: MowerMap, opts: RenderMowerSvgOptions = {}): string {
  const width = opts.width ?? DEFAULT_WIDTH;
  const height = opts.height ?? DEFAULT_HEIGHT;
  const padding = opts.padding ?? DEFAULT_PADDING;

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`,
    `<rect width="100%" height="100%" fill="${BACKGROUND}"/>`,
  ];

  const allPoints: MowerPoint[] = [];
  for (const zone of map.zones) {
    allPoints.push(...zone.path);
  }
  for (const area of map.forbiddenAreas) {
    allPoints.push(...area.path);
  }
  for (const path of map.paths) {
    allPoints.push(...path.path);
  }
  for (const contour of map.contours) {
    allPoints.push(...contour.path);
  }
  for (const mp of map.mowPaths) {
    for (const seg of mp.segments) {
      allPoints.push(...seg);
    }
  }

  if (allPoints.length === 0) {
    lines.push(
      `<text x="${Math.trunc(width / 2)}" y="${Math.trunc(height / 2)}" ` +
        `font-family="Arial, sans-serif" font-size="16" fill="${TEXT_COLOR}" ` +
        `text-anchor="middle">No map data available</text>`,
    );
    lines.push('</svg>');
    return lines.join('\n');
  }

  const bounds = calculateBounds(allPoints);
  const multiZone = map.zones.length > 1;

  // 0. Inter-zone navigation paths — dashed grey, behind everything.
  for (const navPath of map.paths) {
    const dashed = svgPathFromSegments(
      [navPath.path],
      bounds,
      width,
      height,
      padding,
      NAV_PATH,
      3,
      true,
    );
    if (dashed) {
      lines.push(dashed);
    }
  }

  // 1. Zone fills (only when more than one zone, matching the donor).
  map.zones.forEach((zone, i) => {
    if (!multiZone) {
      return;
    }
    const palette = ZONE_COLORS[i % ZONE_COLORS.length];
    const [fill, outline] = palette ?? ZONE_COLORS[0] ?? ['#cccccc', '#888888'];
    const poly = svgPolygon(zone.path, bounds, width, height, padding, fill, outline);
    if (poly) {
      lines.push(poly);
    }
  });

  // 2. Zone boundary outlines.
  map.zones.forEach((zone, i) => {
    const outline = multiZone
      ? (ZONE_COLORS[i % ZONE_COLORS.length]?.[1] ?? MAP_BOUNDARY)
      : MAP_BOUNDARY;
    const boundary = svgPathFromSegments(
      [zone.path],
      bounds,
      width,
      height,
      padding,
      outline,
      2,
      false,
    );
    if (boundary) {
      lines.push(boundary);
    }
  });

  // 3. Mow-path tracks — orange.
  for (const mp of map.mowPaths) {
    const track = svgPathFromSegments(
      mp.segments,
      bounds,
      width,
      height,
      padding,
      MOWING_PATH,
      2,
      false,
    );
    if (track) {
      lines.push(track);
    }
  }

  // 4. Forbidden-area polygons — red-ish fill.
  for (const area of map.forbiddenAreas) {
    const poly = svgPolygon(
      area.path,
      bounds,
      width,
      height,
      padding,
      OBSTACLE_FILL,
      OBSTACLE_STROKE,
    );
    if (poly) {
      lines.push(poly);
    }
  }

  lines.push('</svg>');
  return lines.join('\n');
}
