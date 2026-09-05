/**
 * RTMP chunk-stream framing (encoder + incremental reader).
 *
 * LinkVisual "private mode" facts (liblvrtmp.so RTMP_InitPrivateConfig, VERIFIED by disassembly):
 *   m_inChunkSize = m_outChunkSize = 60000, m_stream_id = 1 — and NO SetChunkSize is exchanged.
 *   Hence: we send every message as a single chunk (all control messages are < 1 KB) and we must
 *   parse inbound chunks with a 60000-byte chunk size from the start (a 128 default would desync).
 */

export const MSG = {
  SET_CHUNK_SIZE: 1,
  ABORT: 2,
  ACK: 3,
  USER_CONTROL: 4,
  WINDOW_ACK_SIZE: 5,
  SET_PEER_BW: 6,
  AUDIO: 8,
  VIDEO: 9,
  DATA_AMF0: 18,
  COMMAND_AMF0: 20,
} as const;

export const PRIVATE_MODE_CHUNK_SIZE = 60000;

export interface RtmpMessage {
  csid: number;
  msid: number;
  timestamp: number;
  type: number;
  body: Buffer;
}

export interface EncodeOptions {
  /** 0 = 12-byte header (LARGE), 1 = 8-byte header (MEDIUM, msid inherited). Mirrors librtmp m_headerType. */
  fmt: 0 | 1;
  csid: number;
  msid?: number;
  timestamp?: number;
  type: number;
  body: Buffer;
}

function basicHeader(fmt: number, csid: number): Buffer {
  if (csid < 64) return Buffer.from([(fmt << 6) | csid]);
  if (csid < 320) return Buffer.from([fmt << 6, csid - 64]);
  return Buffer.from([(fmt << 6) | 1, (csid - 64) & 0xff, (csid - 64) >> 8]);
}

/** Encode one message as ONE chunk (no splitting) — exactly what the LinkVisual SDK does on the wire. */
export function encodeMessage(o: EncodeOptions): Buffer {
  if (o.body.length > PRIVATE_MODE_CHUNK_SIZE) {
    throw new Error(`message body ${o.body.length} exceeds private-mode chunk size ${PRIVATE_MODE_CHUNK_SIZE}`);
  }
  const ts = o.timestamp ?? 0;
  const hdrLen = o.fmt === 0 ? 11 : 7;
  const hdr = Buffer.alloc(hdrLen);
  hdr.writeUIntBE(ts >= 0xffffff ? 0xffffff : ts, 0, 3);
  hdr.writeUIntBE(o.body.length, 3, 3);
  hdr[6] = o.type;
  if (o.fmt === 0) hdr.writeUInt32LE(o.msid ?? 0, 7);
  const ext = ts >= 0xffffff ? (() => { const e = Buffer.alloc(4); e.writeUInt32BE(ts, 0); return e; })() : Buffer.alloc(0);
  return Buffer.concat([basicHeader(o.fmt, o.csid), hdr, ext, o.body]);
}

interface CsidState {
  timestamp: number;
  delta: number;
  length: number;
  type: number;
  msid: number;
  extTs: boolean;
  partial: Buffer[];
  received: number;
}

function freshState(): CsidState {
  return { timestamp: 0, delta: 0, length: 0, type: 0, msid: 0, extTs: false, partial: [], received: 0 };
}

/**
 * Incremental chunk reader. Feed raw TCP bytes; get complete messages back.
 * Handles fmt 0..3, 1/2/3-byte basic headers, extended timestamps (also on fmt-3
 * continuations, per spec/librtmp), and dynamic chunk-size changes.
 */
export class ChunkReader {
  chunkSize: number;
  private pending: Buffer = Buffer.alloc(0);
  private readonly streams = new Map<number, CsidState>();

  constructor(chunkSize: number = PRIVATE_MODE_CHUNK_SIZE) {
    this.chunkSize = chunkSize;
  }

  feed(data: Buffer): RtmpMessage[] {
    this.pending = this.pending.length ? Buffer.concat([this.pending, data]) : data;
    const out: RtmpMessage[] = [];
    for (;;) {
      const consumed = this.tryReadChunk(out);
      if (consumed === 0) break;
      this.pending = this.pending.subarray(consumed);
    }
    return out;
  }

  /** Returns bytes consumed for one chunk, or 0 if more data is needed. */
  private tryReadChunk(out: RtmpMessage[]): number {
    const buf = this.pending;
    if (buf.length < 1) return 0;
    const fmt = buf[0]! >> 6;
    let csid = buf[0]! & 0x3f;
    let p = 1;
    if (csid === 0) { if (buf.length < 2) return 0; csid = 64 + buf[1]!; p = 2; }
    else if (csid === 1) { if (buf.length < 3) return 0; csid = 64 + buf[1]! + buf[2]! * 256; p = 3; }

    const st = this.streams.get(csid) ?? freshState();
    const hdrLen = fmt === 0 ? 11 : fmt === 1 ? 7 : fmt === 2 ? 3 : 0;
    if (buf.length < p + hdrLen) return 0;

    let tsField = 0;
    if (fmt <= 2) {
      tsField = buf.readUIntBE(p, 3);
      if (fmt <= 1) { st.length = buf.readUIntBE(p + 3, 3); st.type = buf[p + 6]!; }
      if (fmt === 0) st.msid = buf.readUInt32LE(p + 7);
      st.extTs = tsField === 0xffffff;
    }
    p += hdrLen;
    if (st.extTs) {
      if (buf.length < p + 4) return 0;
      tsField = buf.readUInt32BE(p);
      p += 4;
    }
    const startOfMessage = st.received === 0;
    if (startOfMessage) {
      if (fmt === 0) { st.timestamp = tsField; st.delta = 0; }
      else if (fmt <= 2) { st.delta = tsField; st.timestamp += tsField; }
      else st.timestamp += st.delta; // fmt 3 starting a new message: reuse last delta
    }

    const take = Math.min(this.chunkSize, st.length - st.received);
    if (buf.length < p + take) return 0;
    st.partial.push(Buffer.from(buf.subarray(p, p + take)));
    st.received += take;
    if (st.received >= st.length) {
      out.push({ csid, msid: st.msid, timestamp: st.timestamp, type: st.type, body: Buffer.concat(st.partial) });
      st.partial = [];
      st.received = 0;
    }
    this.streams.set(csid, st);
    return p + take;
  }
}
