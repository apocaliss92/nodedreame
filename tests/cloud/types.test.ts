import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  DreameSession,
  DreameDevice,
  DreameCloudState,
  MiotProp,
  MiotAction,
  PropertyWrite,
  PropertyResult,
} from '../../src/cloud/types.js';
import type { DreameRegion } from '../../src/auth/config.js';

describe('domain types', () => {
  it('compose into well-formed values', () => {
    const session: DreameSession = {
      accessToken: 'a',
      uid: 'u',
      expiresAt: 123,
      region: 'eu',
    };
    const device: DreameDevice = {
      did: 'd',
      model: 'dreame.vacuum.r2532a',
      name: 'Vac',
      online: true,
      raw: { bindDomain: 'x' },
    };
    const prop: MiotProp = { siid: 2, piid: 1 };
    const action: MiotAction = { siid: 5, aiid: 1, in: [] };
    const write: PropertyWrite = { siid: 2, piid: 6, value: 1 };
    const result: PropertyResult = { siid: 2, piid: 1, value: 13, code: 0 };
    const cloud: DreameCloudState = {
      latestStatus: 13,
      battery: 80,
      videoActive: null,
      featureCode2: null,
    };
    expect(session.region satisfies DreameRegion).toBe('eu');
    expect(device.online).toBe(true);
    expect([prop.siid, action.aiid, write.value, result.code, cloud.battery]).toEqual([
      2, 1, 1, 0, 80,
    ]);
    expectTypeOf<DreameSession['region']>().toEqualTypeOf<DreameRegion>();
  });
});
