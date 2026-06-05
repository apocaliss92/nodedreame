import { describe, it, expect } from 'vitest';
import type {
  NodreameOptions,
  PropertyState,
  PropertyChangedEvent,
  StateChangedEvent,
  DeviceEvent,
} from '../../src/api/types.js';

describe('public api types', () => {
  it('NodreameOptions accepts the documented shape', () => {
    const opts: NodreameOptions = {
      username: 'a@b.c',
      password: 'pw',
      region: 'eu',
    };
    expect(opts.username).toBe('a@b.c');
  });

  it('PropertyState carries siid/piid/value/updatedAt', () => {
    const s: PropertyState = { siid: 2, piid: 1, value: 13, updatedAt: 1 };
    expect(s.siid).toBe(2);
  });

  it('event payloads carry the deviceId', () => {
    const pc: PropertyChangedEvent = {
      deviceId: 'D',
      siid: 2,
      piid: 1,
      value: 13,
      previousValue: null,
    };
    const sc: StateChangedEvent = { deviceId: 'D', changes: [pc] };
    const ev: DeviceEvent = { deviceId: 'D', siid: 4, eiid: 1, arguments: [] };
    expect(sc.changes[0]?.deviceId).toBe('D');
    expect(ev.eiid).toBe(1);
  });
});
