/**
 * Raster PNG renderer for a decoded `VacuumMap`.
 *
 * node-dreame ships only the structured model (no image); this is NEW. We paint
 * the run-length `layers` (floor / segments / carpet / walls) one pixel per grid
 * cell (× an optional integer upscale `scale`), then composite the world-frame
 * overlays on top: restricted areas (no-go / no-mop), virtual walls, the cleaning
 * path polylines, AI obstacles, the charger, and the robot (body + heading). A
 * `colorScheme` picks the palette and every overlay is independently toggleable,
 * mirroring how the Home Assistant integration exposes map customization.
 *
 * Coordinate transform: every overlay coordinate is mm in the world frame.
 * `dimensions.left` / `.top` are the world-mm of pixel (0,0) and `.gridSize` is
 * mm-per-pixel, so `xPx = (worldX - left) / gridSize` (then × `scale`).
 *
 * Y IS FLIPPED. Dreame's grid has world-Y increasing DOWNWARD relative to how
 * the robot/dock/app present the floor, so rendering rows top-down produced a
 * VERTICALLY MIRRORED map vs the Dreamehome app / Home Assistant (live-confirmed
 * on r2538z). We reflect in cell space — `yPx = ((height - 1) - cellY) × scale` —
 * applied identically to the run-length base layers ({@link paintRun}) and the
 * world-frame overlays ({@link worldToPx}) so they stay pixel-aligned, and the
 * robot heading's Y component is negated ({@link drawRobot}). Glyph labels are
 * drawn upright (only their anchor is flipped).
 *
 * Pure: only `pngjs` + arithmetic. No casts.
 */

import { PNG } from 'pngjs';
import type {
  VacuumMap,
  MapLayer,
  MapRun,
  MapPoint,
  MapPose,
  MapDimensions,
  MapCleanedAreaOverlay,
} from './types.js';

/**
 * A named map palette. The first four mirror the HA integration's `color_scheme`
 * choices; `flat` / `dark-neon` / `materico` are node-dreame additions for
 * distinct visual styles.
 */
export type MapColorScheme =
  | 'dreame-light'
  | 'dreame-dark'
  | 'mijia-light'
  | 'tasshack'
  | 'flat'
  | 'dark-neon'
  | 'materico';

export interface RenderVacuumPngOptions {
  /** Integer upscale factor (nearest-neighbour). Default 1. */
  scale?: number;
  /** Palette. Default `'dreame-light'`. */
  colorScheme?: MapColorScheme;
  /** Draw the cleaning/mopping path polylines. Default true. */
  showPath?: boolean;
  /** Draw the robot marker (body + heading). Default true. */
  showRobot?: boolean;
  /** Draw the charger / dock marker. Default true. */
  showCharger?: boolean;
  /** Draw no-go / no-mop restricted areas. Default true. */
  showNoGo?: boolean;
  /** Draw user-defined virtual walls. Default true. */
  showVirtualWalls?: boolean;
  /** Draw AI-detected obstacle markers. Default true. */
  showObstacles?: boolean;
  /** Draw the segment id as a tiny label at each room centroid. Default false. */
  showSegmentLabels?: boolean;
  /** Draw each room's NAME (falls back to `Room <id>`) at its centroid. Default
   *  false. Mutually useful with `showSegmentLabels` (names take the centroid). */
  showSegmentNames?: boolean;
  /** Tint the cleaned-area overlay (`cleanedArea.cleaned`) when present. Default false. */
  showCleanedArea?: boolean;
  /** Outline low-clearance "sneak under furniture" zones. Default true. */
  showFurniture?: boolean;
  /** Colour AI obstacle markers by their `type` (else a single accent). Default true. */
  colorObstaclesByType?: boolean;
}

type Rgba = readonly [number, number, number, number];

/** Per-scheme colour set. Segment fills derive from `segHsv` (golden-angle hue). */
interface Palette {
  floor: Rgba;
  wall: Rgba;
  carpet: Rgba;
  /** Segment fill saturation / value (hue is per-id golden angle). */
  segSat: number;
  segVal: number;
  path: Rgba;
  robotBody: Rgba;
  robotHeading: Rgba;
  charger: Rgba;
  noGoFill: Rgba;
  noGoBorder: Rgba;
  noMopFill: Rgba;
  noMopBorder: Rgba;
  virtualWall: Rgba;
  obstacle: Rgba;
  label: Rgba;
}

const SCHEMES: Record<MapColorScheme, Palette> = {
  'dreame-light': {
    floor: [210, 222, 235, 255],
    wall: [60, 60, 60, 255],
    carpet: [180, 150, 120, 200],
    segSat: 0.45,
    segVal: 0.95,
    path: [60, 110, 180, 235],
    robotBody: [40, 70, 110, 255],
    robotHeading: [255, 255, 255, 255],
    charger: [40, 160, 80, 255],
    noGoFill: [220, 60, 60, 70],
    noGoBorder: [200, 40, 40, 220],
    noMopFill: [60, 120, 220, 60],
    noMopBorder: [40, 90, 200, 200],
    virtualWall: [200, 40, 40, 230],
    obstacle: [230, 150, 30, 255],
    label: [40, 40, 40, 255],
  },
  'dreame-dark': {
    floor: [40, 46, 56, 255],
    wall: [15, 15, 18, 255],
    carpet: [80, 66, 52, 200],
    segSat: 0.5,
    segVal: 0.62,
    path: [120, 170, 230, 235],
    robotBody: [120, 170, 230, 255],
    robotHeading: [20, 24, 30, 255],
    charger: [60, 200, 110, 255],
    noGoFill: [220, 70, 70, 80],
    noGoBorder: [230, 70, 70, 220],
    noMopFill: [70, 130, 230, 70],
    noMopBorder: [80, 140, 235, 210],
    virtualWall: [230, 70, 70, 235],
    obstacle: [240, 180, 60, 255],
    label: [225, 230, 240, 255],
  },
  'mijia-light': {
    floor: [225, 232, 240, 255],
    wall: [70, 78, 92, 255],
    carpet: [188, 162, 132, 200],
    segSat: 0.35,
    segVal: 0.98,
    path: [80, 130, 200, 230],
    robotBody: [30, 100, 200, 255],
    robotHeading: [255, 255, 255, 255],
    charger: [40, 170, 90, 255],
    noGoFill: [225, 70, 70, 70],
    noGoBorder: [205, 45, 45, 220],
    noMopFill: [70, 130, 225, 60],
    noMopBorder: [50, 100, 205, 200],
    virtualWall: [205, 45, 45, 230],
    obstacle: [235, 160, 35, 255],
    label: [45, 52, 64, 255],
  },
  tasshack: {
    floor: [200, 210, 225, 255],
    wall: [80, 80, 95, 255],
    carpet: [176, 148, 118, 205],
    segSat: 0.5,
    segVal: 0.9,
    path: [50, 100, 170, 235],
    robotBody: [35, 60, 100, 255],
    robotHeading: [255, 255, 255, 255],
    charger: [35, 150, 75, 255],
    noGoFill: [215, 55, 55, 75],
    noGoBorder: [195, 35, 35, 220],
    noMopFill: [55, 115, 215, 65],
    noMopBorder: [35, 85, 195, 205],
    virtualWall: [195, 35, 35, 230],
    obstacle: [225, 145, 25, 255],
    label: [35, 42, 54, 255],
  },
  // Flat-design: soft neutral floor, bright low-saturation segment fills, thin
  // mid-grey walls, a single vivid accent for the path.
  flat: {
    floor: [236, 239, 241, 255],
    wall: [120, 132, 145, 255],
    carpet: [205, 185, 160, 200],
    segSat: 0.28,
    segVal: 0.99,
    path: [255, 138, 101, 240],
    robotBody: [38, 50, 56, 255],
    robotHeading: [255, 255, 255, 255],
    charger: [38, 166, 154, 255],
    noGoFill: [239, 83, 80, 60],
    noGoBorder: [229, 57, 53, 210],
    noMopFill: [66, 165, 245, 55],
    noMopBorder: [30, 136, 229, 200],
    virtualWall: [229, 57, 53, 225],
    obstacle: [255, 167, 38, 255],
    label: [55, 71, 79, 255],
  },
  // Dark-neon: near-black floor with high-saturation glowing segment fills, a
  // bright cyan path and magenta robot.
  'dark-neon': {
    floor: [16, 18, 27, 255],
    wall: [5, 6, 10, 255],
    carpet: [60, 50, 80, 200],
    segSat: 0.85,
    segVal: 0.95,
    path: [0, 230, 255, 240],
    robotBody: [255, 45, 170, 255],
    robotHeading: [255, 255, 255, 255],
    charger: [0, 255, 150, 255],
    noGoFill: [255, 40, 90, 80],
    noGoBorder: [255, 40, 90, 235],
    noMopFill: [40, 130, 255, 75],
    noMopBorder: [40, 160, 255, 225],
    virtualWall: [255, 40, 90, 235],
    obstacle: [255, 220, 0, 255],
    label: [230, 240, 255, 255],
  },
  // Materico (Material-design): light grey surface, Material-palette segment
  // fills, indigo/teal accents.
  materico: {
    floor: [245, 245, 245, 255],
    wall: [97, 97, 97, 255],
    carpet: [188, 170, 144, 205],
    segSat: 0.55,
    segVal: 0.93,
    path: [63, 81, 181, 235],
    robotBody: [48, 63, 159, 255],
    robotHeading: [255, 255, 255, 255],
    charger: [0, 150, 136, 255],
    noGoFill: [244, 67, 54, 65],
    noGoBorder: [211, 47, 47, 215],
    noMopFill: [33, 150, 243, 60],
    noMopBorder: [25, 118, 210, 205],
    virtualWall: [211, 47, 47, 225],
    obstacle: [255, 152, 0, 255],
    label: [33, 33, 33, 255],
  },
};

/** HSV (h in degrees, s/v in 0..1) → opaque RGBA. */
function hsvToRgba(h: number, s: number, v: number): Rgba {
  const c = v * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) {
    r = c;
    g = x;
  } else if (hp < 2) {
    r = x;
    g = c;
  } else if (hp < 3) {
    g = c;
    b = x;
  } else if (hp < 4) {
    g = x;
    b = c;
  } else if (hp < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const m = v - c;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255), 255];
}

/** Deterministic per-segment palette (golden-angle hue spread) under a scheme. */
function segmentColor(id: number, pal: Palette): Rgba {
  const hue = (id * 137.508) % 360;
  return hsvToRgba(hue, pal.segSat, pal.segVal);
}

export function renderVacuumPng(map: VacuumMap, opts: RenderVacuumPngOptions = {}): Buffer {
  const scale = Math.max(1, Math.trunc(opts.scale ?? 1));
  const pal = SCHEMES[opts.colorScheme ?? 'dreame-light'];
  const w = Math.max(1, map.dimensions.width * scale);
  const h = Math.max(1, map.dimensions.height * scale);
  const png = new PNG({ width: w, height: h });
  png.data.fill(0); // transparent background

  const dim = map.dimensions;

  // 1) Spatial layers (floor / segments / carpet / walls), painted in order.
  for (const layer of map.layers) {
    paintLayer(png, layer, dim.height, scale, pal);
  }

  // 1b) Cleaned-area overlay — a translucent tint over already-cleaned cells,
  // reprojected from the inner overlay grid onto the parent grid. Drawn over the
  // base layers but under every marker/zone. Opt-in (default off).
  if (opts.showCleanedArea === true && map.cleanedArea !== null) {
    paintCleanedArea(png, map.cleanedArea, dim, scale, pal.path);
  }

  // 2) Restricted areas — translucent fill + opaque border.
  if (opts.showNoGo !== false) {
    for (const area of map.restrictedAreas) {
      const fill = area.kind === 'noMop' ? pal.noMopFill : pal.noGoFill;
      const border = area.kind === 'noMop' ? pal.noMopBorder : pal.noGoBorder;
      const a = worldToPx(area.bbox.xMin, area.bbox.yMin, dim, scale);
      const b = worldToPx(area.bbox.xMax, area.bbox.yMax, dim, scale);
      fillRect(png, a.x, a.y, b.x, b.y, fill);
      strokeRect(png, a.x, a.y, b.x, b.y, border);
    }
  }

  // 3) Virtual walls — opaque line segments.
  if (opts.showVirtualWalls !== false) {
    for (const vw of map.virtualWalls) {
      const a = worldToPx(vw.from.x, vw.from.y, dim, scale);
      const b = worldToPx(vw.to.x, vw.to.y, dim, scale);
      drawLine(png, a.x, a.y, b.x, b.y, pal.virtualWall, Math.max(1, scale));
    }
  }

  // 4) Cleaning path polylines ("linee di lavaggio").
  if (opts.showPath !== false) {
    for (const path of map.paths) {
      drawPolyline(png, path.points, dim, scale, pal.path, Math.max(1, scale));
    }
  }

  // 4b) Low-clearance "sneak under furniture" zones — outlined translucent
  // polygons. Default on.
  if (opts.showFurniture !== false) {
    for (const zone of map.lowLyingAreas) {
      paintFurnitureZone(png, zone.points, dim, scale);
    }
  }

  // 5) AI obstacles — small filled diamonds, coloured by type by default so
  // distinct hazards read differently (the type→label table lives browser-side).
  if (opts.showObstacles !== false) {
    const byType = opts.colorObstaclesByType !== false;
    for (const ob of map.obstacles) {
      const p = worldToPx(ob.x, ob.y, dim, scale);
      const color = byType ? obstacleColor(ob.type) : pal.obstacle;
      drawDiamond(png, p.x, p.y, Math.max(2, scale * 2), color);
    }
  }

  // 6) Charger / dock.
  if (opts.showCharger !== false && map.dock !== null) {
    drawCharger(png, map.dock, dim, scale, pal);
  }

  // 7) Robot (body + heading wedge) — drawn last so it sits on top.
  if (opts.showRobot !== false && map.robot !== null) {
    drawRobot(png, map.robot, dim, scale, pal);
  }

  // 8) Room labels at centroids — the NAME when requested (falls back to
  // `ROOM <id>` for an unnamed room), else just the numeric id. Names win the
  // centroid when both flags are set.
  if (opts.showSegmentNames === true || opts.showSegmentLabels === true) {
    for (const seg of map.segments) {
      const p = worldToPx(seg.centroid.x, seg.centroid.y, dim, scale);
      const text = opts.showSegmentNames === true ? labelText(seg.name, seg.id) : String(seg.id);
      drawLabel(png, p.x, p.y, text, pal.label, Math.max(1, scale));
    }
  }

  return PNG.sync.write(png);
}

// ── Coordinate transform ────────────────────────────────────────────────────

interface Px {
  x: number;
  y: number;
}

/** World-mm → scaled pixel coordinate. Y is reflected in cell space so the map
 *  matches the Dreamehome app / HA orientation (see file header). */
function worldToPx(worldX: number, worldY: number, dim: MapDimensions, scale: number): Px {
  const cellY = (worldY - dim.top) / dim.gridSize;
  return {
    x: Math.round(((worldX - dim.left) / dim.gridSize) * scale),
    y: Math.round((dim.height - 1 - cellY) * scale),
  };
}

// ── Layer painting (run-length) ─────────────────────────────────────────────

function paintLayer(
  png: PNG,
  layer: MapLayer,
  dimHeight: number,
  scale: number,
  pal: Palette,
): void {
  const color =
    layer.type === 'segment'
      ? segmentColor(layer.segmentId ?? 0, pal)
      : layer.type === 'wall'
        ? pal.wall
        : layer.type === 'carpet'
          ? pal.carpet
          : pal.floor;
  for (const run of layer.runs) {
    paintRun(png, run, dimHeight, color, scale);
  }
}

/** Fill the scale×scale block of every pixel in a `[xPx, yPx, len]` run. The row
 *  is reflected (`(height-1)-yPx`) to match {@link worldToPx}'s Y flip. */
function paintRun(png: PNG, run: MapRun, dimHeight: number, color: Rgba, scale: number): void {
  const [xPx, yPx, len] = run;
  const baseY = (dimHeight - 1 - yPx) * scale;
  for (let i = 0; i < len; i += 1) {
    const baseX = (xPx + i) * scale;
    for (let dy = 0; dy < scale; dy += 1) {
      for (let dx = 0; dx < scale; dx += 1) {
        setPixel(png, baseX + dx, baseY + dy, color);
      }
    }
  }
}

// ── Pixel primitives ────────────────────────────────────────────────────────

/** Opaque write (or alpha-composite when the colour is translucent). */
function setPixel(png: PNG, x: number, y: number, color: Rgba): void {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const off = (y * png.width + x) * 4;
  const a = color[3];
  if (a >= 255) {
    png.data[off] = color[0];
    png.data[off + 1] = color[1];
    png.data[off + 2] = color[2];
    png.data[off + 3] = 255;
    return;
  }
  // Source-over alpha composite onto the existing pixel.
  const sa = a / 255;
  const da = (png.data[off + 3] ?? 0) / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return;
  for (let k = 0; k < 3; k += 1) {
    const src = color[k] ?? 0;
    const dst = png.data[off + k] ?? 0;
    png.data[off + k] = Math.round((src * sa + dst * da * (1 - sa)) / outA);
  }
  png.data[off + 3] = Math.round(outA * 255);
}

/** Translucent (or opaque) axis-aligned filled rectangle, endpoints inclusive. */
function fillRect(png: PNG, x0: number, y0: number, x1: number, y1: number, color: Rgba): void {
  const xa = Math.min(x0, x1);
  const xb = Math.max(x0, x1);
  const ya = Math.min(y0, y1);
  const yb = Math.max(y0, y1);
  for (let y = ya; y <= yb; y += 1) {
    for (let x = xa; x <= xb; x += 1) {
      setPixel(png, x, y, color);
    }
  }
}

/** Rectangle border (1px). */
function strokeRect(png: PNG, x0: number, y0: number, x1: number, y1: number, color: Rgba): void {
  const xa = Math.min(x0, x1);
  const xb = Math.max(x0, x1);
  const ya = Math.min(y0, y1);
  const yb = Math.max(y0, y1);
  for (let x = xa; x <= xb; x += 1) {
    setPixel(png, x, ya, color);
    setPixel(png, x, yb, color);
  }
  for (let y = ya; y <= yb; y += 1) {
    setPixel(png, xa, y, color);
    setPixel(png, xb, y, color);
  }
}

/** Bresenham line with a square pen of side `thickness`. */
function drawLine(
  png: PNG,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: Rgba,
  thickness: number,
): void {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const r = Math.max(0, Math.trunc((thickness - 1) / 2));
  for (;;) {
    for (let oy = -r; oy <= r; oy += 1) {
      for (let ox = -r; ox <= r; ox += 1) {
        setPixel(png, x + ox, y + oy, color);
      }
    }
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Connect consecutive world-frame points with line segments. */
function drawPolyline(
  png: PNG,
  points: readonly MapPoint[],
  dim: MapDimensions,
  scale: number,
  color: Rgba,
  thickness: number,
): void {
  for (let i = 1; i < points.length; i += 1) {
    const p0 = points[i - 1];
    const p1 = points[i];
    if (p0 === undefined || p1 === undefined) continue;
    const a = worldToPx(p0.x, p0.y, dim, scale);
    const b = worldToPx(p1.x, p1.y, dim, scale);
    drawLine(png, a.x, a.y, b.x, b.y, color, thickness);
  }
}

/** Filled disk (square-distance) of radius `r` centred at `cx,cy`. */
function drawDisk(png: PNG, cx: number, cy: number, r: number, color: Rgba): void {
  const rr = r * r;
  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      if (dx * dx + dy * dy <= rr) setPixel(png, cx + dx, cy + dy, color);
    }
  }
}

// ── Markers ─────────────────────────────────────────────────────────────────

function drawRobot(
  png: PNG,
  robot: MapPose,
  dim: MapDimensions,
  scale: number,
  pal: Palette,
): void {
  const p = worldToPx(robot.x, robot.y, dim, scale);
  const r = Math.max(3, scale * 3);
  drawDisk(png, p.x, p.y, r, pal.robotBody);
  // Heading wedge: a short line from the centre toward `angle` (degrees, CCW).
  // The Y axis is flipped (see worldToPx), so the screen-Y component is negated
  // to keep the arrow pointing the real direction.
  const rad = (robot.angle * Math.PI) / 180;
  const hx = Math.round(p.x + Math.cos(rad) * r);
  const hy = Math.round(p.y - Math.sin(rad) * r);
  drawLine(png, p.x, p.y, hx, hy, pal.robotHeading, Math.max(1, Math.trunc(scale / 2) + 1));
}

function drawCharger(
  png: PNG,
  dock: MapPose,
  dim: MapDimensions,
  scale: number,
  pal: Palette,
): void {
  const p = worldToPx(dock.x, dock.y, dim, scale);
  const r = Math.max(2, scale * 2);
  // A small filled square reads as a dock base.
  fillRect(png, p.x - r, p.y - r, p.x + r, p.y + r, pal.charger);
}

/** Filled diamond (Manhattan disk) of radius `r` — used for AI obstacle markers
 *  so they read distinctly from the round robot body. */
function drawDiamond(png: PNG, cx: number, cy: number, r: number, color: Rgba): void {
  for (let dy = -r; dy <= r; dy += 1) {
    const w = r - Math.abs(dy);
    for (let dx = -w; dx <= w; dx += 1) {
      setPixel(png, cx + dx, cy + dy, color);
    }
  }
}

/** Deterministic per-type obstacle colour (golden-ish hue spread). The integer
 *  `ObstacleType` → human label table lives browser-side; here we only need a
 *  stable, visually distinct hue per type. */
function obstacleColor(type: number): Rgba {
  const hue = (Math.abs(Math.trunc(type)) * 47) % 360;
  return hsvToRgba(hue, 0.85, 0.95);
}

/** Outline colour for low-clearance furniture zones — a translucent violet that
 *  reads on both light and dark schemes. */
const FURNITURE_LINE: Rgba = [150, 110, 200, 235];

/** Outline a low-clearance furniture polygon (closes the loop). */
function paintFurnitureZone(
  png: PNG,
  points: readonly MapPoint[],
  dim: MapDimensions,
  scale: number,
): void {
  if (points.length < 2) return;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a === undefined || b === undefined) continue;
    const pa = worldToPx(a.x, a.y, dim, scale);
    const pb = worldToPx(b.x, b.y, dim, scale);
    drawLine(png, pa.x, pa.y, pb.x, pb.y, FURNITURE_LINE, Math.max(1, scale));
  }
}

/** Tint already-cleaned cells, reprojecting the inner overlay grid (its OWN
 *  dimensions) onto the parent pixel grid. The tint derives from the scheme's
 *  path colour at low alpha. */
function paintCleanedArea(
  png: PNG,
  overlay: MapCleanedAreaOverlay,
  parentDim: MapDimensions,
  scale: number,
  baseColor: Rgba,
): void {
  const tint: Rgba = [baseColor[0], baseColor[1], baseColor[2], 55];
  const inner = overlay.dimensions;
  const block = Math.max(1, Math.round((inner.gridSize / parentDim.gridSize) * scale));
  for (const [xPx, yPx, len] of overlay.cleaned) {
    for (let i = 0; i < len; i += 1) {
      const worldX = inner.left + (xPx + i) * inner.gridSize;
      const worldY = inner.top + yPx * inner.gridSize;
      const p = worldToPx(worldX, worldY, parentDim, scale);
      for (let dy = 0; dy < block; dy += 1) {
        for (let dx = 0; dx < block; dx += 1) {
          setPixel(png, p.x + dx, p.y + dy, tint);
        }
      }
    }
  }
}

/** Build a renderable room label: uppercase the name (accents stripped, only
 *  glyph-defined chars kept, capped length), falling back to `ROOM <id>` when a
 *  room is unnamed or reduces to nothing renderable. */
function labelText(name: string | null, id: number): string {
  const raw = (name ?? '').trim();
  const base = raw.length > 0 ? raw : `ROOM ${id}`;
  const upper = base
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  let out = '';
  for (const ch of upper) {
    if (GLYPHS[ch] !== undefined) out += ch;
  }
  const trimmed = out.trim().slice(0, 14);
  return trimmed.length > 0 ? trimmed : `ROOM ${id}`;
}

// ── Tiny 3×5 digit/sign font for segment labels ─────────────────────────────

// Each glyph is 5 rows of a 3-bit mask (bit 2 = left column). Only the
// characters that can appear in `String(segmentId)` are defined; an unknown
// char is skipped so an unexpected id never throws.
const GLYPHS: Record<string, readonly number[]> = {
  '0': [0b111, 0b101, 0b101, 0b101, 0b111],
  '1': [0b010, 0b110, 0b010, 0b010, 0b111],
  '2': [0b111, 0b001, 0b111, 0b100, 0b111],
  '3': [0b111, 0b001, 0b111, 0b001, 0b111],
  '4': [0b101, 0b101, 0b111, 0b001, 0b001],
  '5': [0b111, 0b100, 0b111, 0b001, 0b111],
  '6': [0b111, 0b100, 0b111, 0b101, 0b111],
  '7': [0b111, 0b001, 0b010, 0b010, 0b010],
  '8': [0b111, 0b101, 0b111, 0b101, 0b111],
  '9': [0b111, 0b101, 0b111, 0b001, 0b111],
  '-': [0b000, 0b000, 0b111, 0b000, 0b000],
  ' ': [0b000, 0b000, 0b000, 0b000, 0b000],
  A: [0b010, 0b101, 0b111, 0b101, 0b101],
  B: [0b110, 0b101, 0b110, 0b101, 0b110],
  C: [0b011, 0b100, 0b100, 0b100, 0b011],
  D: [0b110, 0b101, 0b101, 0b101, 0b110],
  E: [0b111, 0b100, 0b110, 0b100, 0b111],
  F: [0b111, 0b100, 0b110, 0b100, 0b100],
  G: [0b011, 0b100, 0b101, 0b101, 0b011],
  H: [0b101, 0b101, 0b111, 0b101, 0b101],
  I: [0b111, 0b010, 0b010, 0b010, 0b111],
  J: [0b001, 0b001, 0b001, 0b101, 0b010],
  K: [0b101, 0b101, 0b110, 0b101, 0b101],
  L: [0b100, 0b100, 0b100, 0b100, 0b111],
  M: [0b101, 0b111, 0b111, 0b101, 0b101],
  N: [0b101, 0b111, 0b111, 0b111, 0b101],
  O: [0b010, 0b101, 0b101, 0b101, 0b010],
  P: [0b110, 0b101, 0b110, 0b100, 0b100],
  Q: [0b010, 0b101, 0b101, 0b110, 0b011],
  R: [0b110, 0b101, 0b110, 0b101, 0b101],
  S: [0b011, 0b100, 0b010, 0b001, 0b110],
  T: [0b111, 0b010, 0b010, 0b010, 0b010],
  U: [0b101, 0b101, 0b101, 0b101, 0b111],
  V: [0b101, 0b101, 0b101, 0b101, 0b010],
  W: [0b101, 0b101, 0b111, 0b111, 0b101],
  X: [0b101, 0b101, 0b010, 0b101, 0b101],
  Y: [0b101, 0b101, 0b010, 0b010, 0b010],
  Z: [0b111, 0b001, 0b010, 0b100, 0b111],
};

/** Draw `text` centred on `cx,cy` using the 3×5 bitmap font (× `px` per cell). */
function drawLabel(png: PNG, cx: number, cy: number, text: string, color: Rgba, px: number): void {
  const glyphW = 3 * px;
  const glyphH = 5 * px;
  const gap = px;
  const totalW = text.length * glyphW + Math.max(0, text.length - 1) * gap;
  let originX = Math.round(cx - totalW / 2);
  const originY = Math.round(cy - glyphH / 2);
  for (const ch of text) {
    const glyph = GLYPHS[ch];
    if (glyph !== undefined) {
      for (let row = 0; row < 5; row += 1) {
        const bits = glyph[row];
        if (bits === undefined) continue;
        for (let col = 0; col < 3; col += 1) {
          if ((bits & (1 << (2 - col))) === 0) continue;
          for (let sy = 0; sy < px; sy += 1) {
            for (let sx = 0; sx < px; sx += 1) {
              setPixel(png, originX + col * px + sx, originY + row * px + sy, color);
            }
          }
        }
      }
    }
    originX += glyphW + gap;
  }
}
