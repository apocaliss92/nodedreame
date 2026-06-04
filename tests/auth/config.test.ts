import { describe, it, expect } from 'vitest';
import {
  REGION_HOSTS,
  REGION_DEFAULT_COUNTRY,
  REGION_DEFAULT_LANG,
  OAUTH_BASIC_AUTH,
  APP_META,
  APP_USER_AGENT,
  TENANT_DREAME,
  TENANT_MOVA,
  COMMAND_FROM_FIELD,
  IOT_COM_PREFIX_DREAME,
  IOT_COM_PREFIX_MOVA,
  CONTENT_TYPE_JSON,
  CONTENT_TYPE_FORM,
  ALL_REGIONS,
} from '../../src/auth/config.js';

describe('region tables', () => {
  it('covers all 8 regions with the same key set', () => {
    expect(ALL_REGIONS).toEqual(['eu', 'us', 'cn', 'ru', 'sg', 'in', 'de', 'tw']);
    for (const r of ALL_REGIONS) {
      expect(REGION_HOSTS[r]).toMatch(/^[a-z]+\.iot\.dreame\.tech:13267$/);
      expect(REGION_DEFAULT_COUNTRY[r]).toMatch(/^[A-Z]{2}$/);
      expect(REGION_DEFAULT_LANG[r]).toMatch(/^[a-z]{2}$/);
    }
  });

  it('aliases de→eu host and tw→cn host', () => {
    expect(REGION_HOSTS.de).toBe('eu.iot.dreame.tech:13267');
    expect(REGION_HOSTS.tw).toBe('cn.iot.dreame.tech:13267');
    expect(REGION_HOSTS.eu).toBe('eu.iot.dreame.tech:13267');
    expect(REGION_HOSTS.us).toBe('us.iot.dreame.tech:13267');
  });
});

describe('oauth + app constants', () => {
  it('decodes the basic-auth header to dreame_appv1:AP^dv@z@SQYVxN88', () => {
    expect(OAUTH_BASIC_AUTH.startsWith('Basic ')).toBe(true);
    const decoded = Buffer.from(OAUTH_BASIC_AUTH.slice('Basic '.length), 'base64').toString('utf8');
    expect(decoded).toBe('dreame_appv1:AP^dv@z@SQYVxN88');
  });

  it('exposes app meta, UA, tenants and brand prefixes', () => {
    expect(APP_META).toBe('cv=i_829');
    expect(APP_USER_AGENT).toBe('Dart/3.2 (dart:io)');
    expect(TENANT_DREAME).toBe('000000');
    expect(TENANT_MOVA).toBe('000002');
    expect(COMMAND_FROM_FIELD).toBe('XXXXXX');
    expect(IOT_COM_PREFIX_DREAME).toBe(10000);
    expect(IOT_COM_PREFIX_MOVA).toBe(20000);
    expect(CONTENT_TYPE_JSON).toBe('application/json');
    expect(CONTENT_TYPE_FORM).toBe('application/x-www-form-urlencoded');
  });
});
