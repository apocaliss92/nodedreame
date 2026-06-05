import { describe, it, expect } from 'vitest';
import {
  MowerStatus,
  MowerChargingStatus,
  MowerControlAction,
  MowerTaskStatus,
  MowerFault,
} from '../../../src/models/mower/enums.js';

describe('mower enums', () => {
  it('MowerStatus matches the donor DeviceStatus (2:1)', () => {
    expect(MowerStatus.Mowing).toBe(1);
    expect(MowerStatus.Standby).toBe(2);
    expect(MowerStatus.Paused).toBe(3);
    expect(MowerStatus.PausedDueToErrors).toBe(4);
    expect(MowerStatus.ReturningToCharge).toBe(5);
    expect(MowerStatus.Charging).toBe(6);
    expect(MowerStatus.Mapping).toBe(11);
    expect(MowerStatus.ChargingComplete).toBe(13);
    expect(MowerStatus.Updating).toBe(14);
    expect(MowerStatus.NoStatus).toBe(0);
  });

  it('MowerChargingStatus matches CHARGING_STATUS_MAPPING (3:2)', () => {
    expect(MowerChargingStatus.NotDocked).toBe(0);
    expect(MowerChargingStatus.Charging).toBe(1);
    expect(MowerChargingStatus.NotCharging).toBe(2);
    expect(MowerChargingStatus.ChargingCompleted).toBe(3);
    expect(MowerChargingStatus.ReturnToCharge).toBe(5);
    expect(MowerChargingStatus.ChargingPausedLowTemperature).toBe(16);
  });

  it('MowerControlAction codes match mower_control.py (2:56 entries)', () => {
    expect(MowerControlAction.Queued).toBe(-1);
    expect(MowerControlAction.Continue).toBe(0);
    expect(MowerControlAction.Completed).toBe(2);
    expect(MowerControlAction.Pause).toBe(4);
  });

  it('MowerTaskStatus exposes ONLY the donor-named task-status code (5:104)', () => {
    // Donor service5.py TASK_STATUS_MAPPING names ONLY code 7; codes 2/3/10/13
    // are "Unknown task status: N" and MUST NOT be invented as named members.
    expect(MowerTaskStatus.SpotIncomplete).toBe(7);
    const codes = Object.values(MowerTaskStatus).filter((v) => typeof v === 'number');
    expect(codes).toEqual([7]);
  });

  it('MowerFault mirrors the donor BASE_DEVICE_CODES registry (2:2)', () => {
    expect(MowerFault.NoDeviceCode).toBe(0);
    expect(MowerFault.Tilted).toBe(1);
    expect(MowerFault.Trapped).toBe(2);
    expect(MowerFault.Cutter).toBe(7);
    expect(MowerFault.BatteryOverheat).toBe(11);
    expect(MowerFault.LidarCovered).toBe(12);
    expect(MowerFault.EmergencyStop).toBe(23);
    expect(MowerFault.BatteryLow).toBe(24);
    expect(MowerFault.BackChargeFailed).toBe(31);
    expect(MowerFault.TaskFinish).toBe(48);
    expect(MowerFault.ScheduleTimeout).toBe(68);
    expect(MowerFault.TopCoverOpen).toBe(73);
    // Contiguous 0..73 — every documented base code is present.
    const codes = Object.values(MowerFault)
      .filter((v): v is number => typeof v === 'number')
      .sort((a, b) => a - b);
    expect(codes).toEqual(Array.from({ length: 74 }, (_, i) => i));
  });
});
