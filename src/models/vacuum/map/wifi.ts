/**
 * WiFi-signal map decode + render.
 *
 * The robot builds a Wi-Fi coverage map (map service SIID 6: action `wifiMap`
 * aiid 4 requests the last stored one, prop `PropWifiMap` piid 15 advertises the
 * OSS object). The blob is the SAME envelope/format as a normal map — a 27-byte
 * header + a width*height pixel grid — but each pixel's low nibble encodes the
 * Wi-Fi signal level instead of a floor/wall class (reversed from the app's
 * `getWifiMapInfo`, `mapInfo[i] & 15`):
 *
 *   10 = unreached (measured, no usable signal)
 *   11 = 1 bar (weakest)   12 = 2 bars   13 = 3 bars   14 = 4 bars (strongest)
 *
 * `left/top/gridSize` (world origin + mm-per-cell) and the robot/charger poses
 * come from the header, so a single blob is enough to sample the signal at any
 * world point — including the robot's own position.
 */
import { PNG } from 'pngjs';
import type { MapDimensions, MapPose } from './types.js';
import { unwrapEnvelope, looksLikeBase64Zlib, HEADER_SIZE, ANGLE_ABSENT } from './envelope.js';
import { parseMapHeader } from './header.js';
import type { VacuumMapDecodeOptions } from './types.js';

/** Bars (1–4) keyed by the raw pixel nibble; 10 = unreached (0 bars). */
const NIBBLE_TO_BARS: Record<number, number> = { 10: 0, 11: 1, 12: 2, 13: 3, 14: 4 };
const isWifiNibble = (n: number): boolean => n >= 10 && n <= 14;

/** Heatmap colours, matching the app (weakest→strongest), plus unreached + map outline. */
const NIBBLE_RGBA: Record<number, [number, number, number, number]> = {
  2: [0xb0, 0xb6, 0xbe, 0xff], // map border (context)
  3: [0xf2, 0xf4, 0xf7, 0xff], // mapped floor (context)
  10: [0xe5, 0xea, 0xee, 0xff], // unreached
  11: [0xd9, 0xe2, 0xef, 0xff], // 1 bar
  12: [0xcd, 0xda, 0xef, 0xff], // 2 bars
  13: [0xa1, 0xbd, 0xf2, 0xff], // 3 bars
  14: [0x81, 0xa8, 0xf5, 0xff], // 4 bars
};

export interface WifiSignalMap {
  readonly dimensions: MapDimensions;
  /** Robot pose from the frame header, or null when absent. */
  readonly robot: MapPose | null;
  /** Charging-dock pose from the frame header, or null when absent. */
  readonly dock: MapPose | null;
  /** Raw per-cell nibble (`pixel & 15`), row-major (width*height). */
  readonly cells: Uint8Array;
  /** Signal bars (1–4) at a world point, 0 = unreached, or null = no Wi-Fi data / off-map. */
  signalAt(worldX: number, worldY: number): number | null;
  /** Signal bars at the robot's own position (or null when unknown). */
  readonly currentSignal: number | null;
}

const poseOrNull = (x: number, y: number, a: number): MapPose | null =>
  x === 0 && y === 0 ? null : { x, y, angle: a === ANGLE_ABSENT ? 0 : a };

/** Decode a Wi-Fi map blob (raw string/Buffer or already-inflated) into signal cells + geometry. */
export function decodeWifiSignalMap(
  input: string | Buffer,
  opts: VacuumMapDecodeOptions = {},
): WifiSignalMap {
  const inflated =
    typeof input === 'string'
      ? unwrapEnvelope(input, opts)
      : looksLikeBase64Zlib(input)
        ? unwrapEnvelope(input.toString('latin1'), opts)
        : input;

  const header = parseMapHeader(inflated);
  const { width, height, gridSize, left, top } = header;
  const pixelEnd = HEADER_SIZE + width * height;
  const grid = inflated.subarray(HEADER_SIZE, pixelEnd);

  const cells = new Uint8Array(width * height);
  for (let i = 0; i < cells.length; i++) cells[i] = (grid[i] ?? 0) & 0x0f;

  const dimensions: MapDimensions = { left, top, width, height, gridSize };
  const robot = poseOrNull(header.robotX, header.robotY, header.robotA);
  const dock = poseOrNull(header.chargerX, header.chargerY, header.chargerA);

  const signalAt = (worldX: number, worldY: number): number | null => {
    if (gridSize <= 0) return null;
    const col = Math.floor((worldX - left) / gridSize);
    const row = Math.floor((worldY - top) / gridSize);
    if (col < 0 || col >= width || row < 0 || row >= height) return null;
    const nibble = cells[row * width + col] ?? 0;
    return isWifiNibble(nibble) ? NIBBLE_TO_BARS[nibble]! : null;
  };

  return {
    dimensions,
    robot,
    dock,
    cells,
    signalAt,
    currentSignal: robot ? signalAt(robot.x, robot.y) : null,
  };
}

export interface RenderWifiSignalPngOptions {
  /** Upscale factor (each map cell → scale×scale px). Default 4. */
  scale?: number;
  /** Draw a marker at the robot position. Default true. */
  markRobot?: boolean;
}

/**
 * Render a simple Wi-Fi coverage heatmap PNG (weakest→strongest blue, unreached
 * grey, no-data transparent), with an optional robot marker — a ready-to-show
 * image for consumers.
 */
export function renderWifiSignalPng(map: WifiSignalMap, opts: RenderWifiSignalPngOptions = {}): Buffer {
  const scale = Math.max(1, Math.floor(opts.scale ?? 4));
  const { width, height, left, top, gridSize } = map.dimensions;
  const png = new PNG({ width: width * scale, height: height * scale, colorType: 6 });

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const nibble = map.cells[row * width + col] ?? 0;
      const rgba = NIBBLE_RGBA[nibble];
      if (!rgba) continue; // no Wi-Fi data here → leave transparent
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = (col * scale + dx) + (row * scale + dy) * width * scale;
          const o = px << 2;
          png.data[o] = rgba[0];
          png.data[o + 1] = rgba[1];
          png.data[o + 2] = rgba[2];
          png.data[o + 3] = rgba[3];
        }
      }
    }
  }

  if ((opts.markRobot ?? true) && map.robot && gridSize > 0) {
    const cx = Math.floor((map.robot.x - left) / gridSize) * scale + Math.floor(scale / 2);
    const cy = Math.floor((map.robot.y - top) / gridSize) * scale + Math.floor(scale / 2);
    const r = Math.max(2, scale);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= width * scale || y >= height * scale) continue;
        const o = (x + y * width * scale) << 2;
        png.data[o] = 0xff;
        png.data[o + 1] = 0x45;
        png.data[o + 2] = 0x00;
        png.data[o + 3] = 0xff;
      }
    }
  }

  return PNG.sync.write(png);
}
