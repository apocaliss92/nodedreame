/**
 * Pure protocol helpers for the camera monitor service — no I/O, so every wire
 * shape here is unit-testable in isolation. The device wraps each action value
 * as `JSON.stringify({ ...params, session })`, where `session` is a per-session
 * correlation token; these builders reproduce that envelope exactly.
 */
import { createHash } from 'node:crypto';
import { MONITOR_PIID, MONITOR_VENDOR_TOKEN } from './constants.js';

/** One `in[]` entry of a MIoT action: a piid plus a JSON-encoded value. */
export interface MonitorActionInput {
  readonly piid: number;
  readonly value: string;
}

/** The parsed shape of a device action reply (`callAction` resolves to this). */
export interface MonitorActionResult {
  readonly code?: number;
  readonly out?: ReadonlyArray<{ piid?: number; value?: unknown }>;
  readonly result?: { out?: ReadonlyArray<{ piid?: number; value?: unknown }> };
}

/**
 * Per-session correlation token, exactly as the app's `Monitor.updateSession()`:
 * `MD5(accountId + "_" + epochMillis)`. Pass an explicit `now` for deterministic
 * tests. `accountId` is the Dreame account uid.
 */
export function makeMonitorSession(accountId: string, now: number = Date.now()): string {
  return createHash('md5').update(`${accountId}_${now}`).digest('hex');
}

/** SHA-256 hex of a privacy access code, as `Monitor.verifyAccessCode` sends it. */
export function hashAccessCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/**
 * Build a single action `in[]` entry: merge `params` with the `session` (session
 * wins on key clash, matching the plugin) and JSON-encode. `params` of `null`
 * yields just `{ session }`.
 */
export function buildActionInput(
  piid: number,
  params: Record<string, unknown> | null,
  session: string,
): MonitorActionInput {
  const value = JSON.stringify({ ...(params ?? {}), session });
  return { piid, value };
}

/** `startMonitor` value params for a given vendor + channel (iotId). */
export function startMonitorParams(
  iotId: string,
  vendor: 'ali' | 'tx',
  area: string,
): Record<string, unknown> {
  return {
    token: MONITOR_VENDOR_TOKEN[vendor],
    channelId: iotId,
    area,
    operType: 'monitor',
    operation: 'start',
  };
}

/** `stopMonitor` value params. */
export function stopMonitorParams(): Record<string, unknown> {
  return { operType: 'monitor', operation: 'end' };
}

/** `keep_alive` value params. `videoStatus` is `preparing` until the relay is up, then `opened`. */
export function keepAliveParams(videoStatus: 'preparing' | 'opened'): Record<string, unknown> {
  return { operType: 'keep_alive', videoStatus };
}

/** `getAccessCodeLaunch` params — primes the camera pipeline and reports PIN state. */
export function accessCodeLaunchParams(): Record<string, unknown> {
  return { open: true };
}

/** `verifyAccessCode` params from a plaintext code. `lazymode` mirrors the app default. */
export function verifyAccessCodeParams(code: string, lazymode = 0): Record<string, unknown> {
  return { oldcode: hashAccessCode(code), lazymode };
}

/** `intercom` start params. `phone:1` marks a video-call intercom. */
export function intercomStartParams(opts?: {
  needRecordSound?: boolean;
  videoCall?: boolean;
}): Record<string, unknown> {
  return {
    operType: 'intercom',
    operation: 'start',
    ...(opts?.needRecordSound !== undefined ? { need_record_sound: opts.needRecordSound } : {}),
    ...(opts?.videoCall ? { phone: 1 } : {}),
  };
}

/** `intercom` stop params. */
export function intercomStopParams(): Record<string, unknown> {
  return { operType: 'intercom', operation: 'end' };
}

/** Fill-light brightness params. Value is sent as a STRING, per the plugin. */
export function fillLightParams(value: number): Record<string, unknown> {
  return { value: String(value) };
}

/** The device business `code` from an action reply (0 = accepted); `null` if absent. */
export function actionCode(res: unknown): number | null {
  const r = res as MonitorActionResult | null | undefined;
  return typeof r?.code === 'number' ? r.code : null;
}

/** First `out[0].value` from an action reply (handles both `out` and `result.out`). */
export function firstOutValue(res: unknown): unknown {
  const r = res as MonitorActionResult | null | undefined;
  const out = r?.out ?? r?.result?.out;
  return Array.isArray(out) && out.length > 0 ? out[0]?.value : undefined;
}
