import { describe, it, expect, vi } from 'vitest';
import {
  buildCatalog,
  PropertyAccumulator,
  vacuumDecoders,
  mowerDecoders,
} from '../../src/diagnostics/dumper.js';
import { VacuumDevice } from '../../src/models/vacuum/vacuum-device.js';
import { MowerDevice } from '../../src/models/mower/mower-device.js';
import { MiotState } from '../../src/models/vacuum/enums.js';
import { MowerTaskStatus } from '../../src/models/mower/enums.js';
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

describe('PropertyAccumulator', () => {
  it('records distinct values with count/firstSeen/lastSeen', () => {
    const acc = new PropertyAccumulator(vacuumDecoders());
    acc.record(2, 1, 6, 1000); // MiotState.Charging
    acc.record(2, 1, 6, 1100); // duplicate value, new time
    acc.record(2, 1, 2, 1200); // MiotState.Standby
    const snap = acc.snapshot();
    const obs = snap['2.1'];
    if (!obs) throw new Error('expected 2.1');
    expect(obs.values).toEqual([6, 2]); // distinct, insertion order
    expect(obs.count).toBe(3); // total observations
    expect(obs.firstSeen).toBe(1000);
    expect(obs.lastSeen).toBe(1200);
  });

  it('flags a KNOWN enum value as NOT unmapped and names the enum', () => {
    const acc = new PropertyAccumulator(vacuumDecoders());
    acc.record(2, 1, MiotState.Charging, 1000);
    const obs = acc.snapshot()['2.1'];
    if (!obs) throw new Error('expected 2.1');
    expect(obs.unmapped).toEqual([]);
    expect(obs.enum).toBe('MiotState');
  });

  it('flags a BOGUS value on a mapped key as unmapped', () => {
    const acc = new PropertyAccumulator(vacuumDecoders());
    acc.record(2, 1, 6, 1000); // known
    acc.record(2, 1, 250, 1100); // not a MiotState member
    const obs = acc.snapshot()['2.1'];
    if (!obs) throw new Error('expected 2.1');
    expect(obs.values).toEqual([6, 250]);
    expect(obs.unmapped).toEqual([250]);
  });

  it('flags mower taskStatus (5.104): a known code is mapped, a bogus one is unmapped', () => {
    const acc = new PropertyAccumulator(mowerDecoders());
    acc.record(5, 104, MowerTaskStatus.SpotIncomplete, 1000); // 7 — documented member
    acc.record(5, 104, 99, 1100); // not a MowerTaskStatus member
    const obs = acc.snapshot()['5.104'];
    if (!obs) throw new Error('expected 5.104');
    expect(obs.values).toEqual([7, 99]);
    expect(obs.unmapped).toEqual([99]); // 7 mapped, 99 unmapped
    expect(obs.enum).toBe('MowerTaskStatus');
  });

  it('leaves unmapped empty + enum undefined for an UNMAPPED key (no decoder)', () => {
    const acc = new PropertyAccumulator(vacuumDecoders());
    acc.record(9, 2, 42, 1000); // MAIN_BRUSH_LEFT — a plain percentage, no enum
    const obs = acc.snapshot()['9.2'];
    if (!obs) throw new Error('expected 9.2');
    expect(obs.unmapped).toEqual([]); // no decoder → cannot be "unmapped"
    expect(obs.enum).toBeUndefined();
  });

  it('a bare accumulator (no decoders) records values but never flags unmapped', () => {
    const acc = new PropertyAccumulator();
    acc.record(2, 1, 250, 1000); // bogus, but no decoder table injected
    const obs = acc.snapshot()['2.1'];
    if (!obs) throw new Error('expected 2.1');
    expect(obs.values).toEqual([250]);
    expect(obs.unmapped).toEqual([]);
    expect(obs.enum).toBeUndefined();
  });

  it('coerces non-number raw values to their JSON scalar and never flags them unmapped', () => {
    const acc = new PropertyAccumulator(vacuumDecoders());
    acc.record(4, 18, '13,14', 1000); // FAULTS_STR — a string mirror
    const obs = acc.snapshot()['4.18'];
    if (!obs) throw new Error('expected 4.18');
    expect(obs.values).toEqual(['13,14']);
    expect(obs.unmapped).toEqual([]);
  });

  it('records non-scalar values as a count only (no value entry, no unmapped)', () => {
    const acc = new PropertyAccumulator(vacuumDecoders());
    acc.record(2, 1, { nested: true }, 1000);
    const obs = acc.snapshot()['2.1'];
    if (!obs) throw new Error('expected 2.1');
    expect(obs.count).toBe(1);
    expect(obs.values).toEqual([]);
    expect(obs.unmapped).toEqual([]);
  });
});
