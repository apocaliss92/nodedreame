import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  makeMonitorSession,
  hashAccessCode,
  buildActionInput,
  startMonitorParams,
  stopMonitorParams,
  keepAliveParams,
  accessCodeLaunchParams,
  verifyAccessCodeParams,
  intercomStartParams,
  intercomStopParams,
  fillLightParams,
  actionCode,
  firstOutValue,
} from '../../../src/video/monitor/protocol.js';

describe('monitor protocol helpers', () => {
  it('makeMonitorSession = MD5(accountId + "_" + now), deterministic with a fixed now', () => {
    const now = 1_700_000_000_000;
    const expected = createHash('md5').update(`uid42_${now}`).digest('hex');
    expect(makeMonitorSession('uid42', now)).toBe(expected);
    // Different times yield different tokens.
    expect(makeMonitorSession('uid42', now + 1)).not.toBe(expected);
  });

  it('hashAccessCode is SHA-256 hex of the code', () => {
    expect(hashAccessCode('0000')).toBe(createHash('sha256').update('0000').digest('hex'));
  });

  it('buildActionInput merges session into the value JSON (session wins on key clash)', () => {
    const input = buildActionInput(1, { a: 1, session: 'SHOULD_LOSE' }, 'REAL');
    expect(input.piid).toBe(1);
    expect(JSON.parse(input.value)).toEqual({ a: 1, session: 'REAL' });
  });

  it('buildActionInput with null params yields just the session', () => {
    expect(JSON.parse(buildActionInput(11, null, 'S').value)).toEqual({ session: 'S' });
  });

  it('startMonitorParams maps vendor -> token and carries channel + area', () => {
    expect(startMonitorParams('IOT', 'ali', '4')).toEqual({
      token: 'alify',
      channelId: 'IOT',
      area: '4',
      operType: 'monitor',
      operation: 'start',
    });
    expect(startMonitorParams('IOT', 'tx', '2').token).toBe('tx');
  });

  it('stop / keepalive / accessCodeLaunch param shapes', () => {
    expect(stopMonitorParams()).toEqual({ operType: 'monitor', operation: 'end' });
    expect(keepAliveParams('opened')).toEqual({ operType: 'keep_alive', videoStatus: 'opened' });
    expect(keepAliveParams('preparing').videoStatus).toBe('preparing');
    expect(accessCodeLaunchParams()).toEqual({ open: true });
  });

  it('verifyAccessCodeParams hashes the code and defaults lazymode 0', () => {
    const p = verifyAccessCodeParams('0000');
    expect(p['oldcode']).toBe(hashAccessCode('0000'));
    expect(p['lazymode']).toBe(0);
    expect(verifyAccessCodeParams('0000', 1)['lazymode']).toBe(1);
  });

  it('intercom params include phone/need_record_sound only when set', () => {
    expect(intercomStartParams()).toEqual({ operType: 'intercom', operation: 'start' });
    expect(intercomStartParams({ videoCall: true, needRecordSound: false })).toEqual({
      operType: 'intercom',
      operation: 'start',
      need_record_sound: false,
      phone: 1,
    });
    expect(intercomStopParams()).toEqual({ operType: 'intercom', operation: 'end' });
  });

  it('fillLightParams sends the value as a string', () => {
    expect(fillLightParams(60)).toEqual({ value: '60' });
  });

  it('actionCode reads the numeric device code, else null', () => {
    expect(actionCode({ code: 0 })).toBe(0);
    expect(actionCode({ code: -1 })).toBe(-1);
    expect(actionCode({})).toBeNull();
    expect(actionCode(null)).toBeNull();
  });

  it('firstOutValue handles both out and result.out', () => {
    expect(firstOutValue({ out: [{ piid: 1, value: 'K' }] })).toBe('K');
    expect(firstOutValue({ result: { out: [{ piid: 1, value: 'ok' }] } })).toBe('ok');
    expect(firstOutValue({ out: [] })).toBeUndefined();
    expect(firstOutValue(undefined)).toBeUndefined();
  });
});
