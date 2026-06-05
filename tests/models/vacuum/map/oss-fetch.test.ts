import { describe, it, expect } from 'vitest';
import { OssFetcher } from '../../../../src/models/vacuum/map/oss-fetch.js';
import type { OssFetchInput } from '../../../../src/models/vacuum/map/oss-fetch.js';
import type { FetchImpl } from '../../../../src/transport/fetch.js';
import { decodeVacuumMap } from '../../../../src/models/vacuum/map/decode.js';
import { DreameApiError, DreameTransportError } from '../../../../src/transport/errors.js';
import { buildSyntheticFrame } from './fixtures/build-frame.js';

const SIGNED_URL = 'https://oss.example.com/blob?Signature=abc&Expires=123';

function baseInput(over: Partial<OssFetchInput> = {}): OssFetchInput {
  return {
    host: 'eu.iot.dreame.tech:13267',
    accessToken: 'bearer-token-xyz',
    region: 'eu',
    did: 'device-1',
    model: 'dreame.vacuum.r2532a',
    filename: 'ali_dreame/uid/device-1/7',
    ...over,
  };
}

/**
 * Build a fake fetch that returns the signed-url JSON for the POST and a blob
 * body for the GET. Typed as `FetchImpl` (no cast) so it slots into the seam.
 */
function makeFetch(opts: {
  resolveBody: unknown;
  resolveOk?: boolean;
  blob?: Buffer;
  blobOk?: boolean;
  getThrows?: boolean;
}): { fetchImpl: FetchImpl; posts: string[]; gets: string[] } {
  const posts: string[] = [];
  const gets: string[] = [];
  const fetchImpl: FetchImpl = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    if (method === 'POST') {
      posts.push(url);
      const ok = opts.resolveOk ?? true;
      return new Response(JSON.stringify(opts.resolveBody), {
        status: ok ? 200 : 500,
      });
    }
    gets.push(url);
    if (opts.getThrows) {
      throw new Error('socket hangup');
    }
    const blobOk = opts.blobOk ?? true;
    const body = opts.blob ?? Buffer.from([1, 2, 3]);
    return new Response(blobOk ? body : 'oops', { status: blobOk ? 200 : 404 });
  };
  return { fetchImpl, posts, gets };
}

describe('OssFetcher.resolveUrl', () => {
  it('POSTs to getDownloadUrl with the signed-file body + returns data string', async () => {
    const { fetchImpl, posts } = makeFetch({ resolveBody: { code: 0, data: SIGNED_URL } });
    const fetcher = new OssFetcher({ fetchImpl });
    const url = await fetcher.resolveUrl(baseInput());
    expect(url).toBe(SIGNED_URL);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toBe(
      'https://eu.iot.dreame.tech:13267/dreame-user-iot/iotfile/getDownloadUrl',
    );
  });

  it('caches by did:filename and appends current= on a cache hit with & separator', async () => {
    let clock = 1_000_000;
    const { fetchImpl, posts } = makeFetch({ resolveBody: { code: 0, data: SIGNED_URL } });
    const fetcher = new OssFetcher({ fetchImpl, now: () => clock });
    const first = await fetcher.resolveUrl(baseInput());
    expect(first).toBe(SIGNED_URL);
    clock += 5000;
    const second = await fetcher.resolveUrl(baseInput());
    expect(posts).toHaveLength(1); // served from cache, no second POST
    expect(second).toBe(`${SIGNED_URL}&current=${Math.floor(clock / 1000)}`);
  });

  it('uses ? separator when the cached url has no query string', async () => {
    let clock = 0;
    const plain = 'https://oss.example.com/blob';
    const { fetchImpl } = makeFetch({ resolveBody: { code: 0, data: plain } });
    const fetcher = new OssFetcher({ fetchImpl, now: () => clock });
    await fetcher.resolveUrl(baseInput());
    clock += 1000;
    const hit = await fetcher.resolveUrl(baseInput());
    expect(hit).toBe(`${plain}?current=1`);
  });

  it('throws DreameApiError when data is missing/empty', async () => {
    const { fetchImpl } = makeFetch({ resolveBody: { code: 0, data: '' } });
    const fetcher = new OssFetcher({ fetchImpl });
    await expect(fetcher.resolveUrl(baseInput())).rejects.toBeInstanceOf(DreameApiError);
  });
});

describe('OssFetcher.fetchBlob', () => {
  it('resolves then GETs the signed url and returns a Buffer decodable by decodeVacuumMap', async () => {
    const { envelope } = buildSyntheticFrame({
      mapId: 1,
      frameId: 0,
      frameType: 'I',
      robot: { x: 0, y: 0, a: 0 },
      charger: { x: 0, y: 0, a: 0 },
      gridSize: 50,
      width: 2,
      height: 2,
      left: 0,
      top: 0,
      grid: Buffer.from([63 << 2, 62 << 2, 0, 0]),
      tail: { timestamp_ms: 1 },
    });
    const blob = Buffer.from(envelope, 'utf8');
    const { fetchImpl, gets } = makeFetch({ resolveBody: { code: 0, data: SIGNED_URL }, blob });
    const fetcher = new OssFetcher({ fetchImpl });
    const out = await fetcher.fetchBlob(baseInput());
    expect(out.equals(blob)).toBe(true);
    expect(gets).toEqual([SIGNED_URL]);
    // The fetched bytes are a real OSS envelope: decode them end to end.
    const map = decodeVacuumMap(out.toString('utf8'));
    expect(map.dimensions.width).toBe(2);
    expect(map.dimensions.height).toBe(2);
    expect(map.layers.length).toBeGreaterThan(0);
  });

  it('coalesces concurrent same-key calls into ONE network round-trip', async () => {
    const { fetchImpl, posts, gets } = makeFetch({
      resolveBody: { code: 0, data: SIGNED_URL },
    });
    const fetcher = new OssFetcher({ fetchImpl });
    const [a, b] = await Promise.all([
      fetcher.fetchBlob(baseInput()),
      fetcher.fetchBlob(baseInput()),
    ]);
    expect(a.equals(b)).toBe(true);
    expect(posts).toHaveLength(1);
    expect(gets).toHaveLength(1);
  });

  it('throws DreameApiError on a non-ok blob response', async () => {
    const { fetchImpl } = makeFetch({ resolveBody: { code: 0, data: SIGNED_URL }, blobOk: false });
    const fetcher = new OssFetcher({ fetchImpl });
    await expect(fetcher.fetchBlob(baseInput())).rejects.toBeInstanceOf(DreameApiError);
  });

  it('wraps a network throw as DreameTransportError', async () => {
    const { fetchImpl } = makeFetch({
      resolveBody: { code: 0, data: SIGNED_URL },
      getThrows: true,
    });
    const fetcher = new OssFetcher({ fetchImpl });
    await expect(fetcher.fetchBlob(baseInput())).rejects.toBeInstanceOf(DreameTransportError);
  });
});

describe('OssFetcher.clearCache', () => {
  it('empties the cache so the next resolve re-POSTs', async () => {
    const { fetchImpl, posts } = makeFetch({ resolveBody: { code: 0, data: SIGNED_URL } });
    const fetcher = new OssFetcher({ fetchImpl });
    await fetcher.resolveUrl(baseInput());
    fetcher.clearCache();
    await fetcher.resolveUrl(baseInput());
    expect(posts).toHaveLength(2);
  });
});
