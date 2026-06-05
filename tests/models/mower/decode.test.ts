import { describe, it, expect } from 'vitest';
import { asNum, enumLookup } from '../../../src/models/_shared/decode.js';

enum Demo {
  A = 1,
  B = 2,
  C = 7,
}

describe('shared decode primitives', () => {
  it('asNum coerces only real numbers', () => {
    expect(asNum(5)).toBe(5);
    expect(asNum('5')).toBeNull();
    expect(asNum(null)).toBeNull();
    expect(asNum(undefined)).toBeNull();
    expect(asNum({})).toBeNull();
  });

  it('enumLookup narrows a raw number to the enum member, else null (no cast)', () => {
    const look = enumLookup<Demo>([Demo.A, Demo.B, Demo.C]);
    expect(look(7)).toBe(Demo.C);
    expect(look(2)).toBe(Demo.B);
    expect(look(99)).toBeNull();
    expect(look(null)).toBeNull();
  });
});
