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

  it('MiotState gains the donor-documented codes that were missing', () => {
    // VERIFIED set preserved; donor (DreameVacuumState) codes added.
    expect(MiotState.ReturningToDrain).toBe(31);
    expect(MiotState.Draining).toBe(32);
    expect(MiotState.Emptying).toBe(34);
    expect(MiotState.DustBagDrying).toBe(35);
    expect(MiotState.HeadingToExtraCleaning).toBe(37);
    expect(MiotState.ExtraCleaning).toBe(38);
    expect(MiotState.FindingPet).toBe(96);
    expect(MiotState.Sanitizing).toBe(103);
    expect(MiotState.FloorMaintaining).toBe(107);
  });

  it('MiotError now covers the full donor DreameVacuumErrorCode table', () => {
    // A sample of newly-added documented codes from types.py.
    expect(MiotError.Cliff).toBe(2);
    expect(MiotError.Brush).toBe(12);
    expect(MiotError.LeftWheelMotor).toBe(15);
    expect(MiotError.CameraFault).toBe(40);
    expect(MiotError.LdsError).toBe(48);
    expect(MiotError.NoGoZone).toBe(59);
    expect(MiotError.RobotInHiddenRoom).toBe(78);
    expect(MiotError.DirtyWaterTankFull).toBe(86);
    expect(MiotError.MopCoverError).toBe(209);
    expect(MiotError.ReturnToChargeFailed).toBe(1000);
    // VERIFIED members retain their existing names + integers.
    expect(MiotError.Clear).toBe(0);
    expect(MiotError.RobotLifted).toBe(18);
    expect(MiotError.MopPadsMissing).toBe(120);
  });

  it('TaskStatus gains the donor-documented codes that were missing', () => {
    // VERIFIED live labels preserved on 1/2/3/6/12/14; donor codes filled in.
    expect(TaskStatus.Completed).toBe(0);
    expect(TaskStatus.SpotCleaning).toBe(4);
    expect(TaskStatus.FastMapping).toBe(5);
    expect(TaskStatus.MapCleaningPaused).toBe(10);
    expect(TaskStatus.CruisingPath).toBe(20);
    expect(TaskStatus.StationCleaning).toBe(27);
    expect(TaskStatus.PetFinding).toBe(30);
    expect(TaskStatus.CustomCleaningWashingPaused).toBe(33);
  });
});
