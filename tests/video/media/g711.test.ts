import { describe, it, expect } from 'vitest';
import { pcm16ToALaw, pcm16leToALaw } from '../../../src/video/media/g711.js';

describe('G.711 A-law encoder', () => {
  it('encodes silence (0) to the A-law idle code 0xD5', () => {
    expect(pcm16ToALaw(0)).toBe(0xd5);
  });

  it('is symmetric in sign bit for +/- of the same magnitude', () => {
    const pos = pcm16ToALaw(4096);
    const neg = pcm16ToALaw(-4096);
    // sign bit (0x80) differs; the rest of the code matches.
    expect((pos ^ neg) & 0x80).toBe(0x80);
    expect(pos & 0x7f).toBe(neg & 0x7f);
  });

  it('clamps and stays in byte range across the PCM span', () => {
    for (const s of [-32768, -1, 0, 1, 32767]) {
      const a = pcm16ToALaw(s);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(255);
    }
  });

  it('pcm16leToALaw emits one byte per sample', () => {
    const pcm = Buffer.alloc(320); // 160 samples (20ms @ 8kHz)
    expect(pcm16leToALaw(pcm)).toHaveLength(160);
  });
});
