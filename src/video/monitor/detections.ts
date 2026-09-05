/**
 * Parsers for the robot's on-device AI detections, pushed as camera-service
 * properties (subscribe to `propertyChanged` for SIID 10001):
 *   - piid 110 (`personFollow` / PERSON_DATA): a tracked-person bounding box
 *   - piid 112 (`videoObstacleData`): a list of obstacle boxes
 *
 * The overlay for obstacle boxes is gated on `set_properties siid 28 piid 13 = 1`.
 * Payloads are JSON strings; these parsers are lenient (return `null` on garbage)
 * and normalize timestamps (the device reports nanoseconds).
 */

/** A normalized detection box. Coordinates are passed through as-reported. */
export interface DetectionBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Optional label/class if the payload carries one. */
  readonly label?: string;
  /** Optional confidence if the payload carries one. */
  readonly score?: number;
}

export interface PersonFollowDetection {
  /** Detection time in epoch milliseconds (converted from the device's ns). */
  readonly timestampMs: number;
  readonly box: DetectionBox | null;
}

export interface ObstacleDetection {
  readonly timestampMs: number;
  readonly boxes: readonly DetectionBox[];
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
};

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Device timestamps are nanoseconds; scale to ms (leave already-ms values alone). */
const toMs = (raw: unknown): number => {
  const n = num(raw);
  if (n === undefined) return Date.now();
  // Heuristic: > 1e15 is almost certainly nanoseconds.
  return n > 1e15 ? Math.round(n / 1e6) : n;
};

/** Read a box from either an array `[x,y,w,h]` or an object `{x,y,w,h,...}`. */
const toBox = (raw: unknown): DetectionBox | null => {
  if (Array.isArray(raw) && raw.length >= 4) {
    const [x, y, w, h] = raw;
    if ([x, y, w, h].every((v) => num(v) !== undefined)) {
      return { x: x as number, y: y as number, w: w as number, h: h as number };
    }
    return null;
  }
  const r = asRecord(raw);
  if (!r) return null;
  const x = num(r['x']);
  const y = num(r['y']);
  const w = num(r['w']) ?? num(r['width']);
  const h = num(r['h']) ?? num(r['height']);
  if (x === undefined || y === undefined || w === undefined || h === undefined) return null;
  const label = typeof r['label'] === 'string' ? (r['label'] as string) : undefined;
  const score = num(r['score']) ?? num(r['confidence']);
  return { x, y, w, h, ...(label !== undefined ? { label } : {}), ...(score !== undefined ? { score } : {}) };
};

/** Parse a `personFollow` (piid 110) payload into a normalized detection. */
export function parsePersonFollow(value: unknown): PersonFollowDetection | null {
  const r = asRecord(value);
  if (!r) return null;
  return {
    timestampMs: toMs(r['timestamp'] ?? r['time']),
    box: toBox(r['bbox'] ?? r['box']),
  };
}

/** Parse a `videoObstacleData` (piid 112) payload into normalized boxes. */
export function parseObstacleData(value: unknown): ObstacleDetection | null {
  const r = asRecord(value);
  if (!r) return null;
  const list = r['boxlist'] ?? r['boxes'] ?? r['boxList'];
  const boxes: DetectionBox[] = [];
  if (Array.isArray(list)) {
    for (const item of list) {
      const box = toBox(item);
      if (box) boxes.push(box);
    }
  }
  return { timestampMs: toMs(r['timestamp'] ?? r['time']), boxes };
}
