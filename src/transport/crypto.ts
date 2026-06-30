import { createCipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * App-global secrets extracted from the Dreamehome Flutter binary. These
 * rotate with new app versions — if login starts failing with no obvious
 * cause, re-extract from the latest APK. Last verified against
 * `dreame-meta: cv=i_829`.
 */
const PASSWORD_SALT = 'RAylYC%fmSKp7%Tq';
const RLC_AES_KEY = 'EETjszu*XI5znHsI';

/**
 * Salted MD5 of the plaintext password, lower-case hex. Sent on the wire
 * instead of the cleartext password.
 */
export function hashPassword(plaintext: string): string {
  return createHash('md5')
    .update(plaintext + PASSWORD_SALT)
    .digest('hex');
}

/**
 * Compute the value of the `dreame-rlc` request header: AES-128-ECB (PKCS7
 * padding) of `<region>|<lang>|<country>` with the static app key, output as
 * lowercase hex.
 */
export function buildRlcHeader(region: string, lang: string, country: string): string {
  const plaintext = `${region}|${lang}|${country}`;
  const cipher = createCipheriv('aes-128-ecb', Buffer.from(RLC_AES_KEY, 'utf8'), null);
  const out = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return out.toString('hex');
}

/** Random MQTT client id matching the format used by the Dreamehome app. */
export function randomMqttClientId(): string {
  return 'p_' + randomBytes(8).toString('hex');
}

/**
 * Upper bound for the sendCommand `id`. The Dreame cloud's device-side
 * correlation id is a NARROW integer field: verified live on
 * `dreame.mower.p2255` that ids up to 2^24 (16_777_216) round-trip fine but ids
 * ≳ 1e8 make the cloud return code 80001 "device offline / 指令发送超时" (the
 * oversized id never reaches/echoes from the device, so the cloud reports it
 * unreachable). A 31-bit random id therefore broke EVERY mower command. Keep ids
 * comfortably under that ceiling.
 */
const MAX_REQUEST_ID = 0xffffff;

/** Monotonic counter, seeded with a small random base (mirrors the Dreame app's
 *  `random(1,100)` start). Module-scoped so concurrent fan-out never collides. */
let nextRequestId = Math.floor(Math.random() * 100) + 1;

/**
 * Next `id` for a sendCommand envelope — a small, monotonically increasing
 * integer that wraps under {@link MAX_REQUEST_ID}. MUST stay small: see
 * {@link MAX_REQUEST_ID} for why a large id makes the cloud 80001.
 */
export function randomRequestId(): number {
  nextRequestId = nextRequestId >= MAX_REQUEST_ID ? 1 : nextRequestId + 1;
  return nextRequestId;
}
