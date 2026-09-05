import type { DreameRegion } from '../../auth/config.js';

/**
 * Aliyun IoT App SDK credentials for the Dreamehome app. These are app-global
 * constants baked into the shipped Dreamehome binary — NOT a user secret. The
 * appKey is public and the appSecret only signs the app's own API-Gateway
 * requests (identically for every install); they rotate only with a new app
 * release. Verified against the live x-ca signature (see signing.test.ts).
 * (SAST note: shipped public client credentials, not a leaked user secret.)
 */
export const ALIYUN_APP_KEY = '33974273';
export const ALIYUN_APP_SECRET = '65a62f03ae5eda97af962fecc2e3efa6';

/** Aliyun IoT region id per Dreame region. Only `eu-central-1` is verified live. */
export const ALIYUN_REGION_ID: Record<DreameRegion, string> = {
  eu: 'eu-central-1',
  de: 'eu-central-1',
  us: 'us-east-1',
  cn: 'cn-shanghai',
  ru: 'eu-central-1',
  sg: 'ap-southeast-1',
  in: 'ap-southeast-1',
  tw: 'cn-shanghai',
};

/** IoT App identity/session host (createSessionByAuthCode, connect). */
export function livingAccountHost(regionId: string): string {
  return `living-account.${regionId}.aliyuncs.com`;
}

/** IoT API gateway host (vision/customer/*). */
export function apiIotHost(regionId: string): string {
  return `${regionId}.api-iot.aliyuncs.com`;
}

export const VISION_STREAM_QUERY = '/vision/customer/stream/query';
