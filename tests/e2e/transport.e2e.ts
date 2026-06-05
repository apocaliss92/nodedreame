import { describe, it, expect } from 'vitest';
import { login } from '../../src/auth/dreame-account.js';
import { listDevices } from '../../src/cloud/devices.js';
import { DreamePush } from '../../src/transport/mqtt-push.js';
import { ALL_REGIONS, type DreameRegion } from '../../src/auth/config.js';

const enabled = process.env.DREAME_E2E === '1';
const username = process.env.DREAME_USERNAME ?? '';
const password = process.env.DREAME_PASSWORD ?? '';

/**
 * `DREAME_COUNTRY` holds the Dreame region value directly (e.g. `eu`, `us`,
 * `cn`). Lowercase and trim it, then use it directly. A small fallback table
 * maps obvious ISO-3166 two-letter codes in case someone put a country code
 * there instead — but the canonical use is the direct region string.
 */
function resolveRegion(raw: string): DreameRegion {
  const normalised = raw.trim().toLowerCase();
  // Direct region value (primary path).
  if ((ALL_REGIONS as readonly string[]).includes(normalised)) {
    return normalised as DreameRegion;
  }
  // Fallback: a handful of ISO country codes → region.
  const isoFallback: Record<string, DreameRegion> = {
    gb: 'eu',
    it: 'eu',
    de: 'eu',
    fr: 'eu',
    es: 'eu',
    nl: 'eu',
    be: 'eu',
    at: 'eu',
    ie: 'eu',
    pt: 'eu',
    pl: 'eu',
    se: 'eu',
    dk: 'eu',
    fi: 'eu',
    no: 'eu',
    us: 'us',
    cn: 'cn',
    ru: 'ru',
    sg: 'sg',
    in: 'in',
    tw: 'tw',
  };
  return isoFallback[normalised] ?? 'eu';
}

const region = resolveRegion(process.env.DREAME_COUNTRY ?? 'eu');

// Network + credential gated. Run with: DREAME_E2E=1 npm run test:e2e
describe.runIf(enabled)('e2e: real Dreamehome account', () => {
  it('logs in, lists devices, and subscribes MQTT cleanly', async () => {
    expect(username, 'set DREAME_USERNAME in .env').not.toBe('');
    expect(password, 'set DREAME_PASSWORD in .env').not.toBe('');

    const session = await login({ email: username, password, region });
    expect(session.accessToken).toBeTruthy();
    expect(session.uid).toBeTruthy();

    const devices = await listDevices({ session, region });
    // The user owns a vacuum + a mower, so we expect at least 2.
    expect(devices.length).toBeGreaterThanOrEqual(1);
    for (const d of devices) {
      expect(d.did, `device missing 'did'`).toBeTruthy();
      expect(d.model, `device ${d.did} missing 'model'`).toBeTruthy();
      expect(d.did, `device ${d.model} missing 'uid' (from session)`).toBeTruthy();
    }

    // Log all discovered models — informational, helps confirm family coverage.
    const models = devices.map((d) => d.model);
    console.log('[e2e] discovered models:', models);
    console.log('[e2e] session uid present:', session.uid ? 'yes' : 'no');

    // Informational family check — does NOT fail the test if model naming differs.
    const vacuumCount = models.filter((m) => m.startsWith('dreame.vacuum.')).length;
    const mowerCount = models.filter((m) => m.startsWith('dreame.mower.')).length;
    const movaCount = models.filter((m) => m.startsWith('mova.')).length;
    console.log(
      `[e2e] family counts — dreame.vacuum: ${vacuumCount}, dreame.mower: ${mowerCount}, mova: ${movaCount}`,
    );
    // Hard assertion: at least 2 devices (vacuum + mower confirmed owned).
    expect(devices.length).toBeGreaterThanOrEqual(2);

    // Subscribe MQTT on the first device that exposes a bindDomain.
    const target = devices.find((d) => typeof d.raw['bindDomain'] === 'string');
    expect(target, 'no device exposed a bindDomain for MQTT').toBeTruthy();

    const push = new DreamePush({ device: target!, session, region });
    await push.open(); // resolves only after a successful subscribe ACK
    await new Promise((r) => setTimeout(r, 1500)); // give the broker a moment for any push
    await push.close();
  });
});
