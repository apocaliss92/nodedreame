import { describe, it, expect, vi } from 'vitest';
import { TypedEmitter } from '../../src/transport/typed-emitter.js';
import {
  buildCatalog,
  createDumper,
  PropertyAccumulator,
  vacuumDecoders,
  mowerDecoders,
} from '../../src/diagnostics/dumper.js';
import { DeviceDumpSchema } from '../../src/diagnostics/dump-format.js';
import { VacuumDevice } from '../../src/models/vacuum/vacuum-device.js';
import { MowerDevice } from '../../src/models/mower/mower-device.js';
import { MiotState } from '../../src/models/vacuum/enums.js';
import { MowerTaskStatus } from '../../src/models/mower/enums.js';
import type { DreameDevice, DreameSession } from '../../src/cloud/types.js';
import type { DeviceEvent, PropertyChangedEvent } from '../../src/api/types.js';

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

/** The event map the dumper observes — exactly the BaseDevice slice it hooks. */
type FakeEvents = {
  propertyChanged: [PropertyChangedEvent];
  event: [DeviceEvent];
};

/**
 * A minimal fake satisfying the dumper's DumperDevice slice (cast-free). Extends
 * the same {@link TypedEmitter} a real device uses, so its `on`/`off`/`emit` are
 * correctly typed and structurally assignable to {@link DumperDevice}; the leak
 * assertions read `rawEmitter.listenerCount(event)`.
 */
class FakeDevice extends TypedEmitter<FakeEvents> {
  model = 'dreame.vacuum.r2532a';
  deviceId = 'd1';
  capabilities = { model: this.model, has: (): boolean => false, list: (): string[] => ['mop'] };
  refreshCalls = 0;
  readonly #counts = new Map<string, number>();
  override on<K extends keyof FakeEvents & string>(
    event: K,
    listener: (...args: FakeEvents[K]) => void,
  ): this {
    this.#counts.set(event, (this.#counts.get(event) ?? 0) + 1);
    return super.on(event, listener);
  }
  override off<K extends keyof FakeEvents & string>(
    event: K,
    listener: (...args: FakeEvents[K]) => void,
  ): this {
    this.#counts.set(event, Math.max(0, (this.#counts.get(event) ?? 0) - 1));
    return super.off(event, listener);
  }
  async refreshFromCache(): Promise<void> {
    this.refreshCalls += 1;
  }
  emitProperty(siid: number, piid: number, value: unknown): void {
    this.emit('propertyChanged', {
      deviceId: this.deviceId,
      siid,
      piid,
      value,
      previousValue: null,
    });
  }
  emitEvent(siid: number, eiid: number, args: unknown[]): void {
    this.emit('event', { deviceId: this.deviceId, siid, eiid, arguments: args });
  }
  countOf(event: 'propertyChanged' | 'event'): number {
    return this.#counts.get(event) ?? 0;
  }
  totalListeners(): number {
    return this.countOf('propertyChanged') + this.countOf('event');
  }
}

/** A fake device with NO refreshFromCache — exercises the feature-detect skip. */
class NoRefreshDevice extends TypedEmitter<FakeEvents> {
  model = 'dreame.vacuum.r2532a';
  deviceId = 'd1';
  capabilities = { model: this.model, has: (): boolean => false, list: (): string[] => ['mop'] };
  emitProperty(siid: number, piid: number, value: unknown): void {
    this.emit('propertyChanged', {
      deviceId: this.deviceId,
      siid,
      piid,
      value,
      previousValue: null,
    });
  }
}

describe('Dumper lifecycle', () => {
  it('start() subscribes to propertyChanged + event and does an initial refreshFromCache', async () => {
    const dev = new FakeDevice();
    const dumper = createDumper(dev);
    await dumper.start();
    expect(dev.countOf('propertyChanged')).toBe(1);
    expect(dev.countOf('event')).toBe(1);
    expect(dev.refreshCalls).toBe(1);
    await dumper.stop();
  });

  it('an emitted propertyChanged lands in the accumulator', async () => {
    const dev = new FakeDevice();
    const dumper = createDumper(dev, { refreshIntervalMs: 0 });
    await dumper.start();
    dev.emitProperty(2, 1, 6);
    await dumper.stop();
    const obs = dumper.export().observations.properties['2.1'];
    if (!obs) throw new Error('expected 2.1');
    expect(obs.values).toEqual([6]);
  });

  it('stop() removes every listener (no leaks) and is idempotent', async () => {
    const dev = new FakeDevice();
    const dumper = createDumper(dev);
    await dumper.start();
    await dumper.stop();
    await dumper.stop(); // idempotent — no throw, no double-remove
    expect(dev.totalListeners()).toBe(0);
  });

  it('ignores further emits after stop()', async () => {
    const dev = new FakeDevice();
    const dumper = createDumper(dev, { refreshIntervalMs: 0 });
    await dumper.start();
    dev.emitProperty(2, 1, 6);
    await dumper.stop();
    dev.emitProperty(2, 1, 2); // listener detached — must be ignored
    const obs = dumper.export().observations.properties['2.1'];
    if (!obs) throw new Error('expected 2.1');
    expect(obs.values).toEqual([6]);
  });

  it('start() is idempotent (a second start does not double-subscribe)', async () => {
    const dev = new FakeDevice();
    const dumper = createDumper(dev);
    await dumper.start();
    await dumper.start();
    expect(dev.countOf('propertyChanged')).toBe(1);
    await dumper.stop();
  });

  it('arms a periodic refreshFromCache on the configured interval', async () => {
    vi.useFakeTimers();
    try {
      const dev = new FakeDevice();
      const dumper = createDumper(dev, { refreshIntervalMs: 1000 });
      await dumper.start();
      expect(dev.refreshCalls).toBe(1); // initial
      await vi.advanceTimersByTimeAsync(1000);
      expect(dev.refreshCalls).toBe(2);
      await dumper.stop();
      await vi.advanceTimersByTimeAsync(5000);
      expect(dev.refreshCalls).toBe(2); // timer cleared on stop
    } finally {
      vi.useRealTimers();
    }
  });

  it('tolerates a target without refreshFromCache (bare BaseDevice)', async () => {
    // A bare device that OMITS refreshFromCache (optional in DumperDevice) — the
    // dumper must feature-detect and skip the shadow refresh without throwing.
    const dev = new NoRefreshDevice();
    const dumper = createDumper(dev);
    await dumper.start();
    dev.emitProperty(2, 1, 6); // still captures live propertyChanged
    await dumper.stop();
    const obs = dumper.export().observations.properties['2.1'];
    if (!obs) throw new Error('expected 2.1');
    expect(obs.values).toEqual([6]);
  });
});

describe('Dumper export', () => {
  it('exports a zod-valid dump after start→observe→stop', async () => {
    const dev = new FakeDevice();
    const dumper = createDumper(dev, { refreshIntervalMs: 0 });
    await dumper.start();
    dev.emitProperty(2, 1, 6); // MiotState.Charging
    dev.emitProperty(2, 1, 250); // bogus → unmapped
    await dumper.stop();
    const dump = dumper.export();
    expect(DeviceDumpSchema.safeParse(dump).success).toBe(true);
    expect(dump.library).toBe('nodedreame');
    expect(dump.device.model).toBe('dreame.vacuum.r2532a');
    const obs = dump.observations.properties['2.1'];
    if (!obs) throw new Error('expected 2.1');
    expect(obs.values).toEqual([6, 250]);
    expect(obs.unmapped).toEqual([250]);
    expect(obs.enum).toBe('MiotState');
    expect(dump.catalog.commands?.map((c) => c.name) ?? []).toContain('START');
  });

  it('anonymizes a leaked custom device name / secret in the dump', async () => {
    const dev = new FakeDevice();
    dev.model = 'dreame.vacuum.r2532a';
    const dumper = createDumper(dev, { captureRawFrames: true, refreshIntervalMs: 0 });
    await dumper.start();
    // a raw event whose arguments carry a leaked customName + did
    dev.emitEvent(4, 1, [{ customName: 'Gianluca', did: 'SECRET' }]);
    await dumper.stop();
    const json = dumper.exportJson();
    expect(json).not.toContain('Gianluca');
    expect(json).not.toContain('SECRET');
    expect(json).toContain('[redacted]');
  });

  // FIX 1 — the real `did` is set as `deviceId` on raw payloads; with
  // captureRawFrames it must NOT survive into the exported JSON.
  it('scrubs the real deviceId from raw frames (captureRawFrames) — FIX 1', async () => {
    const dev = new FakeDevice();
    dev.deviceId = 'REAL-DID-123456789';
    const dumper = createDumper(dev, { captureRawFrames: true, refreshIntervalMs: 0 });
    await dumper.start();
    dev.emitProperty(2, 1, 6); // raw payload carries deviceId = the real did
    await dumper.stop();
    const json = dumper.exportJson();
    expect(json).not.toContain('REAL-DID-123456789');
    expect(json).toContain('[redacted]');
  });

  // FIX 2 — a propertyChanged value that is an OSS object path embeds uid/did.
  it('scrubs an OSS-path property VALUE (uid/did) end-to-end — FIX 2', async () => {
    const dev = new FakeDevice();
    const dumper = createDumper(dev, { captureRawFrames: true, refreshIntervalMs: 0 });
    await dumper.start();
    dev.emitProperty(6, 3, 'ali_dreame/UID123/DID456/0');
    await dumper.stop();
    const json = dumper.exportJson();
    expect(json).not.toContain('UID123');
    expect(json).not.toContain('DID456');
  });

  it('exportJson is deterministic for the same observations', async () => {
    const build = async (): Promise<string> => {
      const dev = new FakeDevice();
      const d = createDumper(dev, { refreshIntervalMs: 0 });
      await d.start();
      dev.emitProperty(2, 1, 6);
      await d.stop();
      return d.exportJson();
    };
    const a = await build();
    const b = await build();
    // meta timestamps differ; strip them before comparing structure.
    const strip = (s: string): string =>
      s.replace(/"(startedAt|durationMs|generatedAt|firstSeen|lastSeen|at)":\s*\d+/g, '"$1":0');
    expect(strip(a)).toBe(strip(b));
  });
});

describe('Dumper is strictly read-only', () => {
  it('never invokes any action/command on a real VacuumDevice', async () => {
    const v = vacuum();
    const spies = [
      vi.spyOn(v, 'startCleaning'),
      vi.spyOn(v, 'pause'),
      vi.spyOn(v, 'stop'),
      vi.spyOn(v, 'dock'),
      vi.spyOn(v, 'locate'),
      vi.spyOn(v, 'callAction'),
      vi.spyOn(v, 'setProperty'),
      vi.spyOn(v, 'cleanSegments'),
    ];
    // Stub refreshFromCache so we don't hit the network in a unit test.
    vi.spyOn(v, 'refreshFromCache').mockResolvedValue(undefined);
    const dumper = createDumper(v, { refreshIntervalMs: 0 });
    await dumper.start();
    v.emit('propertyChanged', { deviceId: 'd1', siid: 2, piid: 1, value: 6, previousValue: null });
    await dumper.stop();
    const dump = dumper.export();
    expect(dump.observations.properties['2.1']?.values).toEqual([6]);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it('flags an unknown mower taskStatus code as unmapped (5.104)', async () => {
    const m = mower();
    vi.spyOn(m, 'refreshFromCache').mockResolvedValue(undefined);
    const dumper = createDumper(m, { refreshIntervalMs: 0 });
    await dumper.start();
    // 7 = SpotIncomplete (known)
    m.emit('propertyChanged', {
      deviceId: 'd1',
      siid: 5,
      piid: 104,
      value: 7,
      previousValue: null,
    });
    // 99 = a donor "Unknown task status" code → unmapped
    m.emit('propertyChanged', {
      deviceId: 'd1',
      siid: 5,
      piid: 104,
      value: 99,
      previousValue: null,
    });
    await dumper.stop();
    const obs = dumper.export().observations.properties['5.104'];
    if (!obs) throw new Error('expected 5.104');
    expect(obs.values).toEqual([7, 99]);
    expect(obs.unmapped).toEqual([99]); // the discovery signal
    expect(obs.enum).toBe('MowerTaskStatus');
    expect(dumper.export().device.type).toBe('mower');
  });

  // FIX 4 — familyOf's `dreame.mower.*` model-prefix branch for a non-BaseDevice
  // fake (the previously uncovered branch; the FakeDevice default is a vacuum).
  it('classifies a non-BaseDevice fake by its dreame.mower.* model prefix', async () => {
    const dev = new FakeDevice();
    dev.model = 'dreame.mower.p2255';
    dev.capabilities = { model: dev.model, has: (): boolean => false, list: (): string[] => [] };
    const dumper = createDumper(dev, { refreshIntervalMs: 0 });
    await dumper.start();
    dev.emitProperty(5, 104, 7); // SpotIncomplete — mower decoder must apply
    await dumper.stop();
    const dump = dumper.export();
    expect(dump.device.type).toBe('mower');
    expect(dump.observations.properties['5.104']?.enum).toBe('MowerTaskStatus');
  });
});
