import { describe, it, expect } from 'vitest';
import { asNum, enumMembers, parseFaultList } from '../../../src/models/vacuum/decode.js';
import { SuctionLevel } from '../../../src/models/vacuum/enums.js';

describe('vacuum decode helpers (cast-free port of node-dreame state.ts)', () => {
  it('asNum returns numbers, null otherwise', () => {
    expect(asNum(3)).toBe(3);
    expect(asNum('3')).toBeNull();
    expect(asNum(null)).toBeNull();
    expect(asNum(undefined)).toBeNull();
  });

  it('enumMembers lists the numeric values of an enum object', () => {
    expect(enumMembers(SuctionLevel)).toEqual([0, 1, 2, 3]);
  });

  it('parseFaultList splits a comma-separated mirror, dropping 0/empty', () => {
    expect(parseFaultList('0')).toEqual([]);
    expect(parseFaultList('')).toEqual([]);
    expect(parseFaultList('74')).toEqual([74]);
    expect(parseFaultList('18,107')).toEqual([18, 107]);
    expect(parseFaultList(120)).toEqual([120]); // bare int push
    expect(parseFaultList(0)).toEqual([]);
    expect(parseFaultList(null)).toEqual([]);
  });
});
