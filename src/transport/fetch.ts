import { fetch as undiciFetch } from 'undici';

/**
 * Narrow fetch-shaped function type backed by undici. Defined here so all
 * callers share one declaration — no DOM lib globals, no casts.
 *
 * We re-export `FetchImpl` from this module as the canonical definition;
 * `transport/http.ts` re-exports it from here so downstream modules have a
 * single import path.
 */
export type FetchImpl = typeof undiciFetch;

/**
 * Default HTTP fetch implementation. We use undici explicitly (rather than the
 * Node global `fetch`) so the library works identically on Node ≥20 and so the
 * exact client behavior is pinned to a known version.
 */
export const defaultFetch: FetchImpl = undiciFetch;
