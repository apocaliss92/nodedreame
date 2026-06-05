import { describe, it, expect } from 'vitest';
// NOTE: robots were asleep during e2e capture — these tests run against a
// SYNTHETIC byte-exact frame builder, not a guaranteed live blob. A real
// captured blob would drop into ./fixtures/real-iframe.b64 as an additive
// assertion (see decode.test.ts).
import {
  parseFrame,
  parseMapJsonTail,
  sliceTailText,
} from '../../../../src/models/vacuum/map/tail.js';
import { MapDecodeError } from '../../../../src/models/vacuum/map/envelope.js';
import { parseMapHeader } from '../../../../src/models/vacuum/map/header.js';
import { parseFloatField, parseIntField } from '../../../../src/models/vacuum/map/field-utils.js';
import { buildSyntheticFrame } from './fixtures/build-frame.js';

const tailObj = { timestamp_ms: 42, mra: 90, tr: 'S1,2' };
const { inflated } = buildSyntheticFrame({
  mapId: 3,
  frameId: 5,
  frameType: 'I',
  robot: { x: 1, y: 2, a: 3 },
  charger: { x: 0, y: 0, a: 0 },
  gridSize: 50,
  width: 2,
  height: 2,
  left: 10,
  top: 20,
  grid: Buffer.from([0, 0, 0, 0]),
  tail: tailObj,
});

describe('tail parsing', () => {
  it('parseFrame returns the parsed header and JSON tail', () => {
    const { header, tail } = parseFrame(inflated);
    expect(header).toMatchObject({ mapId: 3, frameId: 5, frameType: 'I', width: 2, height: 2 });
    expect(tail).toEqual(tailObj);
  });

  it('sliceTailText returns the exact JSON string', () => {
    const header = parseMapHeader(inflated);
    expect(sliceTailText(inflated, header)).toBe(JSON.stringify(tailObj));
  });

  it('throws when the inflated payload is shorter than header+pixels', () => {
    const header = parseMapHeader(inflated);
    expect(() => sliceTailText(inflated.subarray(0, 28), header)).toThrow(MapDecodeError);
  });

  it('parseMapJsonTail returns {} for empty text', () => {
    expect(parseMapJsonTail('')).toEqual({});
  });

  it('parseMapJsonTail throws MapDecodeError on malformed JSON', () => {
    expect(() => parseMapJsonTail('{not json')).toThrow(MapDecodeError);
  });
});

describe('field coercion helpers', () => {
  it('parseFloatField coerces numeric strings and numbers, null otherwise', () => {
    expect(parseFloatField('3.5')).toBe(3.5);
    expect(parseFloatField(3.5)).toBe(3.5);
    expect(parseFloatField('x')).toBeNull();
    expect(parseFloatField(Infinity)).toBeNull();
    expect(parseFloatField(null)).toBeNull();
  });

  it('parseIntField truncates toward zero', () => {
    expect(parseIntField('3.9')).toBe(3);
    expect(parseIntField(-3.9)).toBe(-3);
    expect(parseIntField('x')).toBeNull();
  });
});
