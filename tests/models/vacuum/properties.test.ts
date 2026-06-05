import { describe, it, expect } from 'vitest';
import {
  VACUUM_PROP,
  VACUUM_ACTION,
  BATTERY_PROP,
  SETTINGS_PROP,
  CONSUMABLE_PROP,
} from '../../../src/models/vacuum/properties.js';

describe('vacuum property + action maps (ported)', () => {
  it('STATE / ERROR live on siid 2', () => {
    expect(VACUUM_PROP.STATE).toEqual({ siid: 2, piid: 1 });
    expect(VACUUM_PROP.ERROR).toEqual({ siid: 2, piid: 2 });
  });

  it('CLEAN_MODE_SETTING is the safe write path (siid 2 piid 6)', () => {
    expect(VACUUM_PROP.CLEAN_MODE_SETTING).toEqual({ siid: 2, piid: 6 });
  });

  it('CLEANING_MODE is the trap bitfield (siid 4 piid 23) — kept for reads', () => {
    expect(VACUUM_PROP.CLEANING_MODE).toEqual({ siid: 4, piid: 23 });
  });

  it('suction / water / faults / progress live on siid 4', () => {
    expect(VACUUM_PROP.SUCTION_LEVEL).toEqual({ siid: 4, piid: 4 });
    expect(VACUUM_PROP.WATER_VOLUME).toEqual({ siid: 4, piid: 5 });
    expect(VACUUM_PROP.FAULTS_STR).toEqual({ siid: 4, piid: 18 });
    expect(VACUUM_PROP.TASK_PROGRESS_PCT).toEqual({ siid: 4, piid: 63 });
  });

  it('battery lives on siid 3', () => {
    expect(BATTERY_PROP.LEVEL).toEqual({ siid: 3, piid: 1 });
    expect(BATTERY_PROP.CHARGING_STATUS).toEqual({ siid: 3, piid: 2 });
  });

  it('actions: START siid2 aiid1, STOP siid4 aiid2, CHARGE siid3 aiid1, START_CUSTOM siid4 aiid1, LOCATE siid7 aiid1', () => {
    expect(VACUUM_ACTION.START).toEqual({ siid: 2, aiid: 1 });
    expect(VACUUM_ACTION.PAUSE).toEqual({ siid: 2, aiid: 2 });
    expect(VACUUM_ACTION.STOP).toEqual({ siid: 4, aiid: 2 });
    expect(VACUUM_ACTION.CHARGE).toEqual({ siid: 3, aiid: 1 });
    expect(VACUUM_ACTION.START_CUSTOM).toEqual({ siid: 4, aiid: 1 });
    expect(VACUUM_ACTION.LOCATE).toEqual({ siid: 7, aiid: 1 });
  });

  it('consumables: main/side brush % on piid 2, filter % on piid 1', () => {
    expect(CONSUMABLE_PROP.MAIN_BRUSH_LEFT).toEqual({ siid: 9, piid: 2 });
    expect(CONSUMABLE_PROP.SIDE_BRUSH_LEFT).toEqual({ siid: 10, piid: 2 });
    expect(CONSUMABLE_PROP.FILTER_LEFT).toEqual({ siid: 11, piid: 1 });
  });

  it('volume setting lives on siid 7 piid 1', () => {
    expect(SETTINGS_PROP.VOLUME).toEqual({ siid: 7, piid: 1 });
  });
});
