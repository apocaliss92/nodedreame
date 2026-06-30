import { describe, it, expect } from 'vitest';
import { asNum, enumLookup } from '../../../src/models/_shared/decode.js';
import {
  parseTaskDescriptor,
  parseControlStatus,
  controlActionFor,
  extractMowerConsumableValues,
  parseMowerConsumables,
  mowerConsumableIndex,
  parseMowerHeartbeat,
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

  it('rejects malformed payloads (non-object / no status / bad pair) with null', () => {
    expect(parseControlStatus(null)).toBeNull();
    expect(parseControlStatus({})).toBeNull();
    expect(parseControlStatus({ status: 5 })).toBeNull(); // status not an array
    expect(parseControlStatus({ status: [[1]] })).toBeNull(); // pair too short
    expect(parseControlStatus({ status: [['x', 0]] })).toBeNull(); // non-numeric pair
  });

  it('tolerates unknown control codes (surfaces the zone with action null)', () => {
    // 99 is OUTSIDE the known set; the zone is retained, not dropped.
    const r = parseControlStatus({
      status: [
        [3, 0],
        [4, 99],
      ],
    });
    expect(r).not.toBeNull();
    expect(r?.zones).toEqual([
      [3, 0],
      [4, 99],
    ]); // unknown zone retained alongside the known one
    // primary still resolves from the known actively-mowing entry (code 0)
    expect(r?.action).toBe(MowerControlAction.Continue);
    expect(r?.statusCode).toBe(0);
  });

  it('returns action:null when the primary entry has an unknown code', () => {
    const r = parseControlStatus({ status: [[4, 99]] });
    expect(r).not.toBeNull();
    expect(r?.zones).toEqual([[4, 99]]);
    expect(r?.action).toBeNull();
    expect(r?.statusCode).toBe(99);
  });

  it('controlActionFor maps known codes, null otherwise', () => {
    expect(controlActionFor(0)).toBe(MowerControlAction.Continue);
    expect(controlActionFor(4)).toBe(MowerControlAction.Pause);
    expect(controlActionFor(99)).toBeNull();
  });
});

describe('CMS consumables', () => {
  it('maps consumable aliases to their counter index', () => {
    expect(mowerConsumableIndex('blade')).toBe(0);
    expect(mowerConsumableIndex('blades')).toBe(0);
    expect(mowerConsumableIndex('brush')).toBe(1);
    expect(mowerConsumableIndex('cleaning_brush')).toBe(1);
    expect(mowerConsumableIndex('robot')).toBe(2);
    expect(mowerConsumableIndex('maintenance')).toBe(2);
    expect(mowerConsumableIndex(' BRUSH ')).toBe(1); // trim + lowercase
    expect(mowerConsumableIndex('unknown')).toBeNull();
  });

  it('extracts counter values when the result itself carries a value list', () => {
    expect(extractMowerConsumableValues({ value: [100, 200, 300] })).toEqual([100, 200, 300]);
  });

  it('extracts counter values from a nested d.value payload', () => {
    expect(extractMowerConsumableValues({ d: { value: [1, 2, 3, 4] } })).toEqual([1, 2, 3]);
  });

  it('extracts counter values from the first non-error out[].d entry', () => {
    const result = {
      out: [
        { r: 1, code: 1, d: { value: [9, 9, 9] } }, // error entry — skipped
        { code: 0, d: { value: [10, 20, 30] } }, // ok entry — used
      ],
    };
    expect(extractMowerConsumableValues(result)).toEqual([10, 20, 30]);
  });

  it('coerces numeric strings and truncates floats', () => {
    expect(extractMowerConsumableValues({ value: ['100', 200.9, 300] })).toEqual([100, 200, 300]);
  });

  it('returns null on a malformed or too-short response', () => {
    expect(extractMowerConsumableValues(null)).toBeNull();
    expect(extractMowerConsumableValues({})).toBeNull();
    expect(extractMowerConsumableValues({ value: [1, 2] })).toBeNull();
    expect(extractMowerConsumableValues({ value: [1, 'x', 3] })).toBeNull();
  });

  it('parses readings with correct totals and remaining %', () => {
    // blade total 6000, brush 30000, maintenance 3600.
    const readings = parseMowerConsumables({ value: [1842, 10950, 1840] });
    expect(readings).not.toBeNull();
    if (readings === null) return;
    expect(readings.map((r) => r.key)).toEqual(['blade', 'brush', 'maintenance']);
    expect(readings[0]).toEqual({
      key: 'blade',
      usedMinutes: 1842,
      totalMinutes: 6000,
      remainingPercent: 69.3,
    });
    expect(readings[1]?.remainingPercent).toBe(63.5);
    expect(readings[2]?.remainingPercent).toBe(48.9);
  });

  it('clamps remaining % to 0 when a counter exceeds its total', () => {
    const readings = parseMowerConsumables({ value: [7000, 0, 0] });
    expect(readings?.[0]?.remainingPercent).toBe(0);
    expect(readings?.[1]?.remainingPercent).toBe(100);
  });

  it('returns null readings on a malformed response', () => {
    expect(parseMowerConsumables({ foo: 'bar' })).toBeNull();
  });
});

describe('heartbeat task sub-state (1:1)', () => {
  // Real captured frames from a live dreame.mower.p2255.
  it('returns null task sub-state when not in the mowing main-state', () => {
    const hb = parseMowerHeartbeat([
      206, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100, 161, 255, 0, 0, 128, 204, 127, 206,
    ]);
    expect(hb).not.toBeNull();
    expect(hb?.mainState).toBe(0); // (161 & 0x0F) - 1
    expect(hb?.rawBattery).toBe(100);
    expect(hb?.taskSubState).toBeNull();
  });

  it('decodes starting (subState 34) while mowing', () => {
    const hb = parseMowerHeartbeat([
      206, 0, 0, 0, 0, 0, 0, 4, 0, 0, 128, 100, 213, 34, 0, 54, 128, 204, 127, 206,
    ]);
    expect(hb?.mainState).toBe(4);
    expect(hb?.taskSubState).toBe('starting');
  });

  it('decodes mowing (subState 35) and the battery byte', () => {
    const hb = parseMowerHeartbeat([
      206, 0, 0, 0, 0, 0, 0, 4, 0, 0, 128, 99, 117, 35, 7, 0, 128, 204, 127, 206,
    ]);
    expect(hb?.mainState).toBe(4);
    expect(hb?.subStateRaw).toBe(35);
    expect(hb?.taskSubState).toBe('mowing');
    expect(hb?.rawBattery).toBe(99);
  });

  it('returns null on a malformed / mis-sentinelled / short payload', () => {
    expect(parseMowerHeartbeat(null)).toBeNull();
    expect(parseMowerHeartbeat('x')).toBeNull();
    expect(parseMowerHeartbeat([1, 2, 3])).toBeNull(); // too short
    expect(
      parseMowerHeartbeat([0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 128, 99, 117, 35, 0, 0, 0, 0, 0, 0]),
    ).toBeNull(); // missing 0xCE sentinels
  });
});
