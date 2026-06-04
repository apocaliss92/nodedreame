import { describe, it, expect } from 'vitest';
import { buildHeaders } from '../../src/transport/headers.js';
import { buildRlcHeader } from '../../src/transport/crypto.js';
import {
  APP_META,
  APP_USER_AGENT,
  OAUTH_BASIC_AUTH,
  TENANT_DREAME,
  CONTENT_TYPE_FORM,
  CONTENT_TYPE_JSON,
} from '../../src/auth/config.js';

describe('buildHeaders', () => {
  it('builds the pre-login header set (bearer literal, form content-type)', () => {
    const h = buildHeaders({ region: 'eu', country: 'GB', lang: 'en' });
    expect(h['user-agent']).toBe(APP_USER_AGENT);
    expect(h['authorization']).toBe(OAUTH_BASIC_AUTH);
    expect(h['content-type']).toBe(CONTENT_TYPE_FORM);
    expect(h['dreame-auth']).toBe('bearer');
    expect(h['dreame-meta']).toBe(APP_META);
    expect(h['dreame-rlc']).toBe(buildRlcHeader('eu', 'en', 'GB'));
    expect(h['tenant-id']).toBe(TENANT_DREAME);
  });

  it('uses a bearer token + overrides content-type when supplied', () => {
    const h = buildHeaders({
      region: 'us',
      country: 'US',
      lang: 'en',
      accessToken: 'TOK',
      contentType: CONTENT_TYPE_JSON,
    });
    expect(h['dreame-auth']).toBe('bearer TOK');
    expect(h['content-type']).toBe(CONTENT_TYPE_JSON);
    expect(h['dreame-rlc']).toBe(buildRlcHeader('us', 'en', 'US'));
  });
});
