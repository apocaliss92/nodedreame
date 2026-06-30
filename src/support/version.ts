/** Public name of this library. */
export const LIBRARY_NAME = 'nodedreame';

/**
 * Public version of this library, embedded in a {@link DeviceDump}'s
 * `libraryVersion`. Kept in lock-step with `package.json` (a version-match test
 * guards drift) — a string constant avoids an ESM JSON-import assertion wrinkle
 * in the published bundle.
 */
export const LIBRARY_VERSION = '1.11.9';
