import { describe, it, expect } from 'vitest';
import {
  AUTO_SWITCH_JSON_KEY,
  decodeAutoSwitch,
  decodeAutoSwitchAll,
  supportedAutoSwitchKeys,
  encodeAutoSwitchWrite,
} from '../../../src/models/vacuum/auto-switch.js';

// Real r2538z snapshot of AUTO_SWITCH_SETTINGS (siid 4 piid 50), trimmed.
const LIVE = JSON.stringify([
  { k: 'LessColl', v: 1 },
  { k: 'CleanRoute', v: 3 },
  { k: 'SuperWash', v: 0 },
  { k: 'AutoDry', v: 1 },
  { k: 'SmartAutoMop', v: -1 },
  { k: 'ExtrFreq', v: 2 },
  { k: 'MeticulousTwist', v: -7 },
  { k: 'MopFullyScalable', v: 1 }, // newer-firmware extra, no canonical mapping
]);

describe('auto-switch packed JSON codec (Tasshack v2.0.0b25 parity)', () => {
  describe('decode — JSON list of {k,v}', () => {
    it('reads each setting by its canonical key (bool / enum / sentinel ints)', () => {
      expect(decodeAutoSwitch(LIVE, 'collisionAvoidance')).toBe(1);
      expect(decodeAutoSwitch(LIVE, 'cleaningRoute')).toBe(3);
      expect(decodeAutoSwitch(LIVE, 'ultraCleanMode')).toBe(0);
      expect(decodeAutoSwitch(LIVE, 'autoDrying')).toBe(1);
      expect(decodeAutoSwitch(LIVE, 'autoRecleaning')).toBe(-1);
      expect(decodeAutoSwitch(LIVE, 'mopExtendFrequency')).toBe(2);
      expect(decodeAutoSwitch(LIVE, 'widerCornerCoverage')).toBe(-7);
    });

    it('returns null for a key the payload does not carry', () => {
      expect(decodeAutoSwitch(LIVE, 'uvSterilization')).toBeNull();
    });
  });

  it('decode — single {k,v} object form', () => {
    expect(decodeAutoSwitch(JSON.stringify({ k: 'HotWash', v: 1 }), 'hotWashing')).toBe(1);
  });

  it('decode — coerces numeric-string values to int', () => {
    expect(decodeAutoSwitch(JSON.stringify([{ k: 'FillinLight', v: '1' }]), 'fillLight')).toBe(1);
  });

  it('decode returns null for absent / unparseable / empty values', () => {
    expect(decodeAutoSwitch(null, 'autoDrying')).toBeNull();
    expect(decodeAutoSwitch('not json', 'autoDrying')).toBeNull();
    expect(decodeAutoSwitch('[]', 'autoDrying')).toBeNull();
  });

  describe('presence — supportedAutoSwitchKeys / decodeAutoSwitchAll', () => {
    it('lists exactly the canonical keys the payload reports (skips unmapped extras)', () => {
      const keys = supportedAutoSwitchKeys(LIVE);
      expect(keys).toContain('collisionAvoidance');
      expect(keys).toContain('cleaningRoute');
      expect(keys).toContain('widerCornerCoverage');
      // 'MopFullyScalable' has no canonical key → not listed.
      expect(keys).toHaveLength(7);
    });

    it('returns [] when the value is absent', () => {
      expect(supportedAutoSwitchKeys(null)).toEqual([]);
    });

    it('decodeAutoSwitchAll maps every canonical pair', () => {
      const all = decodeAutoSwitchAll(LIVE);
      expect(all.collisionAvoidance).toBe(1);
      expect(all.cleaningRoute).toBe(3);
      expect(all.autoRecleaning).toBe(-1);
      expect(Object.keys(all)).toHaveLength(7);
    });
  });

  describe('encode — single-key write (Tasshack set_auto_switch_property)', () => {
    it('emits a compact {"k":<key>,"v":<int>} object for the changed setting', () => {
      expect(encodeAutoSwitchWrite('collisionAvoidance', 0)).toBe('{"k":"LessColl","v":0}');
      expect(encodeAutoSwitchWrite('cleaningRoute', 2)).toBe('{"k":"CleanRoute","v":2}');
    });

    it('truncates a non-integer value', () => {
      expect(encodeAutoSwitchWrite('fillLight', 1.9)).toBe('{"k":"FillinLight","v":1}');
    });
  });

  it('the json-key map matches Tasshack DreameVacuumAutoSwitchProperty', () => {
    expect(AUTO_SWITCH_JSON_KEY.collisionAvoidance).toBe('LessColl');
    expect(AUTO_SWITCH_JSON_KEY.cleanGenius).toBe('SmartHost');
    expect(AUTO_SWITCH_JSON_KEY.mopExtend).toBe('MopExtrSwitch');
    expect(AUTO_SWITCH_JSON_KEY.intelligentStainCleaning).toBe('HeavyStainSmart');
    // 33 canonical keys total.
    expect(Object.keys(AUTO_SWITCH_JSON_KEY)).toHaveLength(33);
  });
});
