import { describe, it, expect } from 'vitest';
import {
  resolveSegmentName,
  SEGMENT_TYPE_CODE_TO_NAME,
} from '../../../../src/models/vacuum/map/segment-types.js';

describe('resolveSegmentName', () => {
  it('maps a known room type code to its localized default name', () => {
    expect(resolveSegmentName(1, 0, undefined)).toBe('Living Room');
    expect(resolveSegmentName(4, 0, undefined)).toBe('Kitchen');
    expect(resolveSegmentName(5, 0, undefined)).toBe('Dining Hall');
    expect(resolveSegmentName(8, 0, undefined)).toBe('Corridor');
    expect(resolveSegmentName(3, 0, undefined)).toBe('Study');
  });

  it('suffixes the 2nd+ room of the same type with " {index+1}"', () => {
    expect(resolveSegmentName(2, 0, undefined)).toBe('Primary Bedroom');
    expect(resolveSegmentName(2, 1, undefined)).toBe('Primary Bedroom 2');
    expect(resolveSegmentName(15, 2, undefined)).toBe('Secondary Bedroom 3');
  });

  it('prefers a base64 custom name when type is 0 (custom rooms)', () => {
    // base64("Lavanderia")
    expect(resolveSegmentName(0, 0, 'TGF2YW5kZXJpYQ==')).toBe('Lavanderia');
    expect(resolveSegmentName(undefined, undefined, 'S2l0Y2hlbg==')).toBe('Kitchen');
  });

  it('a known room type wins over a custom name (donor precedence)', () => {
    expect(resolveSegmentName(4, 0, 'TGF2YW5kZXJpYQ==')).toBe('Kitchen');
  });

  it('returns null when there is neither a known type nor a custom name', () => {
    expect(resolveSegmentName(0, 0, undefined)).toBeNull();
    expect(resolveSegmentName(undefined, undefined, undefined)).toBeNull();
    expect(resolveSegmentName(0, 0, '')).toBeNull();
    // unknown (out-of-table) type with no custom name → null
    expect(resolveSegmentName(99, 0, undefined)).toBeNull();
  });

  it('table covers the donor codes 0..15', () => {
    expect(SEGMENT_TYPE_CODE_TO_NAME[0]).toBe('Room');
    expect(SEGMENT_TYPE_CODE_TO_NAME[6]).toBe('Bathroom');
    expect(Object.keys(SEGMENT_TYPE_CODE_TO_NAME)).toHaveLength(16);
  });
});
