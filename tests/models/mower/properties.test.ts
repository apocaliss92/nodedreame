import { describe, it, expect } from 'vitest';
import {
  MOWER_PROP,
  MOWER_ACTION,
  MOWER_EVENT,
  TASK_OPCODE,
  buildResumePayload,
  buildAllAreaPayload,
  buildZonePayload,
  buildEdgePayload,
  buildSpotPayload,
} from '../../../src/models/mower/properties.js';

describe('mower property/action/event maps', () => {
  it('properties map to the donor const.py siid/piid', () => {
    expect(MOWER_PROP.STATUS).toEqual({ siid: 2, piid: 1 });
    expect(MOWER_PROP.SCHEDULING_TASK).toEqual({ siid: 2, piid: 50 });
    expect(MOWER_PROP.MOWER_CONTROL_STATUS).toEqual({ siid: 2, piid: 56 });
    expect(MOWER_PROP.BATTERY).toEqual({ siid: 3, piid: 1 });
    expect(MOWER_PROP.CHARGING_STATUS).toEqual({ siid: 3, piid: 2 });
    expect(MOWER_PROP.TASK_STATUS).toEqual({ siid: 5, piid: 104 });
    expect(MOWER_PROP.POSE_COVERAGE).toEqual({ siid: 1, piid: 4 });
  });

  it('actions map to siid 5 aiids', () => {
    expect(MOWER_ACTION.START_MOWING).toEqual({ siid: 5, aiid: 1 });
    expect(MOWER_ACTION.STOP).toEqual({ siid: 5, aiid: 2 });
    expect(MOWER_ACTION.DOCK).toEqual({ siid: 5, aiid: 3 });
    expect(MOWER_ACTION.PAUSE).toEqual({ siid: 5, aiid: 4 });
  });

  it('mission-completion event is siid 4 eiid 1', () => {
    expect(MOWER_EVENT.MISSION_COMPLETION).toEqual({ siid: 4, eiid: 1 });
  });

  it('TASK_OPCODE.RESUME is the exact continueControl payload', () => {
    expect(TASK_OPCODE.RESUME).toEqual({ m: 'a', p: 0, o: 5 });
    // It must be a NEW object each call to avoid shared-mutable-state leaks.
    expect(buildResumePayload()).toEqual({ m: 'a', p: 0, o: 5 });
    expect(buildResumePayload()).not.toBe(buildResumePayload());
  });

  it('start-mode payload builders match device.py _build_*_task_payload', () => {
    expect(buildAllAreaPayload(2)).toEqual({
      m: 'a',
      p: 0,
      o: 100,
      d: { region_id: [2], area_id: [] },
    });
    expect(buildZonePayload([1, 3])).toEqual({ m: 'a', p: 0, o: 102, d: { region: [1, 3] } });
    expect(buildEdgePayload([[1, 0]])).toEqual({ m: 'a', p: 0, o: 101, d: { edge: [[1, 0]] } });
    expect(buildSpotPayload([5])).toEqual({ m: 'a', p: 0, o: 103, d: { area: [5] } });
  });
});
