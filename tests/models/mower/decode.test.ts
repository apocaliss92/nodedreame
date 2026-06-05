import { describe, it, expect } from 'vitest';
import { asNum, enumLookup } from '../../../src/models/_shared/decode.js';
import {
  parseTaskDescriptor,
  parseControlStatus,
  controlActionFor,
} from '../../../src/models/mower/decode.js';
import { MowerControlAction } from '../../../src/models/mower/enums.js';

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

describe('mower scheduling-task descriptor (2:50)', () => {
  it('parses a TASK object into typed fields', () => {
    const value = {
      t: 'TASK',
      d: { exe: true, o: 67, status: true, area_id: [3], region_id: [1], time: 42 },
    };
    expect(parseTaskDescriptor(value)).toEqual({
      taskType: 'TASK',
      executionActive: true,
      coverageTarget: 67,
      taskActive: true,
      areaId: [3],
      regionId: [1],
      elapsedTime: 42,
    });
  });

  it('returns null for a non-object / malformed descriptor', () => {
    expect(parseTaskDescriptor(null)).toBeNull();
    expect(parseTaskDescriptor('x')).toBeNull();
    expect(parseTaskDescriptor({ t: 'TASK' })).toBeNull(); // missing d
    expect(parseTaskDescriptor({ t: 'TASK', d: { exe: true } })).toBeNull(); // missing required o/status
  });

  it('keeps optional fields null when absent (paused/docked descriptors)', () => {
    const value = { t: 'TASK', d: { exe: false, o: 0, status: false } };
    expect(parseTaskDescriptor(value)).toEqual({
      taskType: 'TASK',
      executionActive: false,
      coverageTarget: 0,
      taskActive: false,
      areaId: null,
      regionId: null,
      elapsedTime: null,
    });
  });
});

describe('mower control status (2:56)', () => {
  it('picks the actively-mowing zone (code 0), else the first entry', () => {
    expect(
      parseControlStatus({
        status: [
          [1, -1],
          [3, 0],
        ],
      }),
    ).toEqual({
      action: MowerControlAction.Continue,
      statusCode: 0,
      zones: [
        [1, -1],
        [3, 0],
      ],
    });
    expect(
      parseControlStatus({
        status: [
          [1, -1],
          [2, 4],
        ],
      }),
    ).toEqual({
      action: MowerControlAction.Queued,
      statusCode: -1,
      zones: [
        [1, -1],
        [2, 4],
      ],
    });
  });

  it('an empty status array -> action null', () => {
    expect(parseControlStatus({ status: [] })).toEqual({
      action: null,
      statusCode: null,
      zones: [],
    });
  });

  it('rejects malformed / unknown-code payloads with null', () => {
    expect(parseControlStatus(null)).toBeNull();
    expect(parseControlStatus({})).toBeNull();
    expect(parseControlStatus({ status: [[1, 99]] })).toBeNull(); // 99 not a known code
  });

  it('controlActionFor maps known codes, null otherwise', () => {
    expect(controlActionFor(0)).toBe(MowerControlAction.Continue);
    expect(controlActionFor(4)).toBe(MowerControlAction.Pause);
    expect(controlActionFor(99)).toBeNull();
  });
});
