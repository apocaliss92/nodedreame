import * as zlib from 'node:zlib';

export interface SyntheticFrameInput {
  mapId: number;
  frameId: number;
  frameType: 'I' | 'P' | 'W';
  robot: { x: number; y: number; a: number };
  charger: { x: number; y: number; a: number };
  gridSize: number;
  width: number;
  height: number;
  left: number;
  top: number;
  grid: Buffer; // width*height bytes
  tail: Record<string, unknown>;
}

const FT: Record<string, number> = { I: 73, P: 80, W: 87 };

/** Build a byte-exact inflated frame + its zlib+urlsafe-base64 envelope. */
export function buildSyntheticFrame(i: SyntheticFrameInput): {
  inflated: Buffer;
  envelope: string; // url-safe base64 of zlib.deflateSync(inflated)
} {
  const head = Buffer.alloc(27);
  head.writeInt16LE(i.mapId, 0);
  head.writeInt16LE(i.frameId, 2);
  head[4] = FT[i.frameType]!;
  head.writeInt16LE(i.robot.x, 5);
  head.writeInt16LE(i.robot.y, 7);
  head.writeInt16LE(i.robot.a, 9);
  head.writeInt16LE(i.charger.x, 11);
  head.writeInt16LE(i.charger.y, 13);
  head.writeInt16LE(i.charger.a, 15);
  head.writeInt16LE(i.gridSize, 17);
  head.writeInt16LE(i.width, 19);
  head.writeInt16LE(i.height, 21);
  head.writeInt16LE(i.left, 23);
  head.writeInt16LE(i.top, 25);
  const tailBytes = Buffer.from(JSON.stringify(i.tail), 'utf8');
  const inflated = Buffer.concat([head, i.grid, tailBytes]);
  const deflated = zlib.deflateSync(inflated);
  const envelope = deflated.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  return { inflated, envelope };
}
