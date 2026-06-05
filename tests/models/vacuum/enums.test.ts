import { describe, it, expect } from 'vitest';
import {
  MiotState,
  ChargingStatus,
  SuctionLevel,
  WaterVolume,
  CleaningMode,
  MiotError,
  TaskStatus,
} from '../../../src/models/vacuum/enums.js';

describe('vacuum enums (ported from node-dreame)', () => {
  it('MiotState carries the VERIFIED r2532a values', () => {
    expect(MiotState.Cleaning).toBe(1);
    expect(MiotState.Charging).toBe(6);
    expect(MiotState.MopDrying).toBe(8);
    expect(MiotState.AutoEmptying).toBe(22);
    expect(MiotState.CleanWashboardBase).toBe(30);
  });

  it('SuctionLevel maps the 4 X50 labels', () => {
    expect(SuctionLevel.Quiet).toBe(0);
    expect(SuctionLevel.Standard).toBe(1);
    expect(SuctionLevel.Intense).toBe(2);
    expect(SuctionLevel.Max).toBe(3);
  });

  it('WaterVolume is the ASSUMED 1-3 enum', () => {
    expect(WaterVolume.Low).toBe(1);
    expect(WaterVolume.Medium).toBe(2);
    expect(WaterVolume.High).toBe(3);
  });

  it('CleaningMode is plain 0-3 (the CLEAN_MODE_SETTING value space)', () => {
    expect(CleaningMode.Sweeping).toBe(0);
    expect(CleaningMode.Mopping).toBe(1);
    expect(CleaningMode.SweepAndMop).toBe(2);
    expect(CleaningMode.MopAfterSweep).toBe(3);
  });

  it('ChargingStatus uses the r2532a-corrected values', () => {
    expect(ChargingStatus.Charging).toBe(1);
    expect(ChargingStatus.Discharging).toBe(2);
    expect(ChargingStatus.Returning).toBe(5);
  });

  it('MiotError carries verified codes', () => {
    expect(MiotError.Clear).toBe(0);
    expect(MiotError.RobotLifted).toBe(18);
    expect(MiotError.TaskComplete).toBe(68);
    expect(MiotError.CleanWaterTankEmpty).toBe(107);
    expect(MiotError.MopPadsMissing).toBe(120);
  });

  it('TaskStatus carries the verified r2532a values', () => {
    expect(TaskStatus.Active).toBe(2);
    expect(TaskStatus.OnDockIdle).toBe(6);
    expect(TaskStatus.NeedsIntervention).toBe(14);
  });
});
