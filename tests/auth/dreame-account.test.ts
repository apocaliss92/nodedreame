import { describe, it, expect, vi } from 'vitest';
import { login, refresh } from '../../src/auth/dreame-account.js';
import { hashPassword, buildRlcHeader } from '../../src/transport/crypto.js';
import { DreameAuthError } from '../../src/transport/errors.js';
import type { FetchImpl } from '../../src/transport/fetch.js';

const tokenResponse = (over: Record<string, unknown> = {}): Response =>
  new Response(
    JSON.stringify({
      access_token: 'ACC',
      refresh_token: 'REF',
      expires_in: 7200,
      uid: 4242,
      region: 'eu',
      ...over,
    }),
    { status: 200 },
  );

describe('login', () => {
  it('POSTs the password grant to /dreame-auth/oauth/token with hashed password + rlc header', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => tokenResponse());
    const before = Date.now();
    const session = await login({
      email: 'a@b.com',
      password: 'hunter2',
      region: 'eu',
      fetchImpl,
    });

    expect(session.accessToken).toBe('ACC');
    expect(session.refreshToken).toBe('REF');
    expect(session.uid).toBe('4242');
    expect(session.region).toBe('eu');
    expect(session.expiresAt).toBeGreaterThanOrEqual(before + 7200 * 1000);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://eu.iot.dreame.tech:13267/dreame-auth/oauth/token');
    const body = (init?.body as URLSearchParams).toString();
    expect(body).toContain('grant_type=password');
    expect(body).toContain('scope=all');
    expect(body).toContain('platform=IOS');
    expect(body).toContain('type=account');
    expect(body).toContain(`username=${encodeURIComponent('a@b.com')}`);
    expect(body).toContain(`password=${hashPassword('hunter2')}`);
    expect(body).toContain('country=GB');
    expect(body).toContain('lang=en');

    const headers = init?.headers as Record<string, string>;
    expect(headers['dreame-auth']).toBe('bearer');
    expect(headers['dreame-meta']).toBe('cv=i_829');
    expect(headers['dreame-rlc']).toBe(buildRlcHeader('eu', 'en', 'GB'));
    expect(headers['content-type']).toBe('application/x-www-form-urlencoded');
  });

  it('throws DreameAuthError on an OAuth error body', async () => {
    const fetchImpl = vi.fn<FetchImpl>(
      async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 200 }),
    );
    await expect(
      login({ email: 'a@b.com', password: 'x', region: 'eu', fetchImpl }),
    ).rejects.toBeInstanceOf(DreameAuthError);
  });

  it('does not leak the refresh_token when access_token is missing', async () => {
    const fetchImpl = vi.fn<FetchImpl>(
      async () =>
        new Response(
          JSON.stringify({
            refresh_token: 'SUPER_SECRET_REFRESH_TOKEN',
            uid: 4242,
            code: 401,
          }),
          { status: 200 },
        ),
    );
    let caught: unknown;
    try {
      await login({ email: 'a@b.com', password: 'x', region: 'eu', fetchImpl });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DreameAuthError);
    const message = (caught as DreameAuthError).message;
    expect(message).not.toContain('SUPER_SECRET_REFRESH_TOKEN');
  });

  it('throws DreameAuthError when uid is missing', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => tokenResponse({ uid: undefined }));
    await expect(
      login({ email: 'a@b.com', password: 'x', region: 'eu', fetchImpl }),
    ).rejects.toBeInstanceOf(DreameAuthError);
  });
});

describe('refresh', () => {
  it('POSTs the refresh_token grant', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => tokenResponse());
    const session = await refresh({ refreshToken: 'REF', region: 'eu', fetchImpl });
    expect(session.accessToken).toBe('ACC');
    const [, init] = fetchImpl.mock.calls[0]!;
    const body = (init?.body as URLSearchParams).toString();
    expect(body).toContain('grant_type=refresh_token');
    expect(body).toContain('refresh_token=REF');
  });
});
