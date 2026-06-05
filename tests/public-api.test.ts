import { describe, it, expect } from 'vitest';
import * as api from '../src/index.js';

describe('public API surface (P1)', () => {
  it('still exports LIBRARY_NAME', () => {
    expect(api.LIBRARY_NAME).toBe('nodedreame');
  });

  it('exports the error classes', () => {
    expect(typeof api.DreameError).toBe('function');
    expect(typeof api.DreameAuthError).toBe('function');
    expect(typeof api.DreameApiError).toBe('function');
    expect(typeof api.DreameDeviceOfflineError).toBe('function');
    expect(typeof api.DreameTransportError).toBe('function');
  });
});

describe('public API surface (P2)', () => {
  it('exports the Nodreame facade', () => {
    expect(typeof api.Nodreame).toBe('function');
  });

  it('exports the BaseDevice handle', () => {
    expect(typeof api.BaseDevice).toBe('function');
  });

  it('exports the capability scaffold', () => {
    expect(typeof api.DefaultCapabilityResolver).toBe('function');
    expect(typeof api.resolveCapabilities).toBe('function');
  });

  it('does NOT leak transport internals (DreamePush is private)', () => {
    expect('DreamePush' in api).toBe(false);
  });
});

describe('public API surface (P3)', () => {
  it('exports VacuumDevice', () => {
    expect(typeof api.VacuumDevice).toBe('function');
  });

  it('exports the vacuum enums', () => {
    expect(api.SuctionLevel.Max).toBe(3);
    expect(api.WaterVolume.High).toBe(3);
    expect(api.CleaningMode.SweepAndMop).toBe(2);
    expect(api.MiotState.Charging).toBe(6);
    expect(typeof api.MiotError).toBe('object');
    expect(typeof api.TaskStatus).toBe('object');
    expect(typeof api.ChargingStatus).toBe('object');
  });

  it('exports the vacuum capability helpers', () => {
    expect(typeof api.getVacuumCapabilities).toBe('function');
    expect(typeof api.VacuumCapabilityResolver).toBe('function');
    expect(typeof api.VACUUM_MODEL_CAPABILITIES).toBe('object');
  });

  it('exports the device-type factory', () => {
    expect(typeof api.deviceClassFor).toBe('function');
  });

  it('does NOT leak vacuum internals (property maps / decode helpers stay private)', () => {
    expect('VACUUM_PROP' in api).toBe(false);
    expect('VACUUM_ACTION' in api).toBe(false);
    expect('parseFaultList' in api).toBe(false);
    expect('enumMembers' in api).toBe(false);
  });
});
