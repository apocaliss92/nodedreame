import { describe, it, expect } from 'vitest';
import {
  MowerStatus,
  MowerChargingStatus,
  MowerControlAction,
  MowerTaskStatus,
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

  it('MowerTaskStatus exposes the observed task-status codes (5:104)', () => {
    expect(MowerTaskStatus.SpotIncomplete).toBe(7);
  });
});
