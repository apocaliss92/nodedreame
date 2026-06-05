/**
 * Raster PNG renderer for a decoded `VacuumMap`.
 *
 * node-dreame ships only the structured model (no image); this is NEW. We paint
 * one pixel per grid cell (× an optional integer upscale `scale`) from the
 * run-length `layers`, later layers painting over earlier ones. The background
 * is transparent. Per-segment colours come from a deterministic golden-angle
 * palette so the same room id always renders the same hue.
 *
 * Pure: only `pngjs` + arithmetic. No casts.
 */

import { PNG } from 'pngjs';
import type { VacuumMap, MapLayer, MapRun } from './types.js';

export interface RenderVacuumPngOptions {
  /** Integer upscale factor (nearest-neighbour). Default 1. */
  scale?: number;
}

type Rgba = readonly [number, number, number, number];

const RGBA: Record<Exclude<MapLayer['type'], 'segment'>, Rgba> = {
  wall: [60, 60, 60, 255],
  floor: [210, 222, 235, 255],
  carpet: [180, 150, 120, 200],
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

/** Deterministic per-segment palette (golden-angle hue spread). */
function segmentColor(id: number): Rgba {
  const hue = (id * 137.508) % 360;
  return hsvToRgba(hue, 0.45, 0.95);
}

export function renderVacuumPng(map: VacuumMap, opts: RenderVacuumPngOptions = {}): Buffer {
  const scale = Math.max(1, Math.trunc(opts.scale ?? 1));
  const w = map.dimensions.width * scale;
  const h = map.dimensions.height * scale;
  const png = new PNG({ width: Math.max(1, w), height: Math.max(1, h) });
  png.data.fill(0); // transparent background
  for (const layer of map.layers) {
    paintLayer(png, layer, scale);
  }
  return PNG.sync.write(png);
}

function paintLayer(png: PNG, layer: MapLayer, scale: number): void {
  const color = layer.type === 'segment' ? segmentColor(layer.segmentId ?? 0) : RGBA[layer.type];
  for (const run of layer.runs) {
    paintRun(png, run, color, scale, png.width, png.height);
  }
}

/** Fill the scale×scale block of every pixel in a `[xPx, yPx, len]` run. */
function paintRun(
  png: PNG,
  run: MapRun,
  color: Rgba,
  scale: number,
  width: number,
  height: number,
): void {
  const [xPx, yPx, len] = run;
  for (let i = 0; i < len; i += 1) {
    const baseX = (xPx + i) * scale;
    const baseY = yPx * scale;
    for (let dy = 0; dy < scale; dy += 1) {
      const py = baseY + dy;
      if (py < 0 || py >= height) {
        continue;
      }
      for (let dx = 0; dx < scale; dx += 1) {
        const px = baseX + dx;
        if (px < 0 || px >= width) {
          continue;
        }
        const off = (py * width + px) * 4;
        png.data[off] = color[0];
        png.data[off + 1] = color[1];
        png.data[off + 2] = color[2];
        png.data[off + 3] = color[3];
      }
    }
  }
}
