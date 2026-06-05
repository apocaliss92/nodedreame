import { describe, it, expect, vi } from 'vitest';
import { buildCatalog } from '../../src/diagnostics/dumper.js';
import { VacuumDevice } from '../../src/models/vacuum/vacuum-device.js';
import { MowerDevice } from '../../src/models/mower/mower-device.js';
import type { DreameDevice, DreameSession } from '../../src/cloud/types.js';

function fakeSession(): DreameSession {
  return { accessToken: 't', uid: 'u', expiresAt: Date.now() + 1e6, region: 'eu' };
}
function fakeDevice(model: string): DreameDevice {
  return { did: 'd1', model, name: 'n', online: true, raw: {} };
}
/** A device built WITHOUT starting it (no MQTT) — pure for catalog/getter reads. */
function vacuum(model = 'dreame.vacuum.r2532a'): VacuumDevice {
  return new VacuumDevice({
    device: fakeDevice(model),
    region: 'eu',
    sessionRef: fakeSession,
    fetchInitialValues: false,
  });
}
function mower(model = 'dreame.mower.p2255'): MowerDevice {
  return new MowerDevice({
    device: fakeDevice(model),
    region: 'eu',
    sessionRef: fakeSession,
    fetchInitialValues: false,
  });
}

describe('buildCatalog (static, read-only)', () => {
  it('captures the vacuum command map WITHOUT executing any action', () => {
    const v = vacuum();
    const startSpy = vi.spyOn(v, 'startCleaning');
    const callSpy = vi.spyOn(v, 'callAction');
    const cat = buildCatalog(v);
    const names = (cat.commands ?? []).map((c) => c.name);
    expect(names).toContain('START');
    expect(names).toContain('PAUSE');
    expect(names).toContain('STOP');
    // The START command carries its declared siid/aiid, not an execution.
    const start = (cat.commands ?? []).find((c) => c.name === 'START');
    expect(start).toEqual({ name: 'START', siid: 2, aiid: 1 });
    expect(startSpy).not.toHaveBeenCalled();
    expect(callSpy).not.toHaveBeenCalled();
  });

  it('captures vacuum capability tokens in catalog.capabilities', () => {
    const cat = buildCatalog(vacuum());
    const caps = cat.capabilities;
    if (!caps) throw new Error('expected capabilities');
    const tokens = caps['tokens'];
    if (!Array.isArray(tokens)) throw new Error('tokens not array');
    expect(tokens).toContain('mop');
  });

  it('captures the mower command map (START_MOWING/STOP/DOCK/PAUSE), none executed', () => {
    const m = mower();
    const startSpy = vi.spyOn(m, 'startMowing');
    const cat = buildCatalog(m);
    const names = (cat.commands ?? []).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['START_MOWING', 'STOP', 'DOCK', 'PAUSE']));
    expect(startSpy).not.toHaveBeenCalled();
  });

  it('returns a commands array even for an unrecognised vacuum model', () => {
    const cat = buildCatalog(
      new VacuumDevice({
        device: fakeDevice('dreame.unknown.x'),
        region: 'eu',
        sessionRef: fakeSession,
        fetchInitialValues: false,
      }),
    );
    // VacuumDevice still exposes VACUUM_ACTION (constructed as a vacuum); a real
    // bare BaseDevice has no model action map → commands empty (covered later).
    expect(Array.isArray(cat.commands)).toBe(true);
  });
});
