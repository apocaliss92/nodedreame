/**
 * G.711 A-law codec (ITU-T G.711) — the intercom uplink format for Dreame
 * cameras (8 kHz, mono, 16-bit PCM in). Pure functions, no state.
 */

const ALAW_SEG_END = [0x1f, 0x3f, 0x7f, 0xff, 0x1ff, 0x3ff, 0x7ff, 0xfff];

/** Encode one 16-bit signed PCM sample to an A-law byte. */
export function pcm16ToALaw(sample: number): number {
  let s = sample;
  let sign = (~s >> 8) & 0x80; // 0x80 for positive, 0 for negative
  if (sign === 0) s = -s;
  if (s > 32635) s = 32635;

  let aval: number;
  if (s >= 256) {
    let seg = 7;
    for (let i = 0; i < 8; i++) {
      if (s <= ALAW_SEG_END[i]!) {
        seg = i;
        break;
      }
    }
    const mantissa = (s >> (seg + 3)) & 0x0f;
    aval = (seg << 4) | mantissa;
  } else {
    aval = s >> 4;
  }
  return (aval ^ sign ^ 0x55) & 0xff;
}

/**
 * Encode a buffer of little-endian 16-bit PCM samples to A-law bytes
 * (one output byte per input sample).
 */
export function pcm16leToALaw(pcm: Buffer): Buffer {
  const count = pcm.length >> 1;
  const out = Buffer.allocUnsafe(count);
  for (let i = 0; i < count; i++) {
    out[i] = pcm16ToALaw(pcm.readInt16LE(i * 2));
  }
  return out;
}
