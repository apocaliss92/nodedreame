/** Supported Dreame cloud regions. */
export type DreameRegion = 'eu' | 'us' | 'cn' | 'ru' | 'sg' | 'in' | 'de' | 'tw';

/** All regions, in canonical order. Used for table-completeness checks. */
export const ALL_REGIONS: readonly DreameRegion[] = [
  'eu',
  'us',
  'cn',
  'ru',
  'sg',
  'in',
  'de',
  'tw',
];

/** Hostname (with non-standard port) of the Dreame auth + API server, per region. */
export const REGION_HOSTS: Record<DreameRegion, string> = {
  eu: 'eu.iot.dreame.tech:13267',
  us: 'us.iot.dreame.tech:13267',
  cn: 'cn.iot.dreame.tech:13267',
  ru: 'ru.iot.dreame.tech:13267',
  sg: 'sg.iot.dreame.tech:13267',
  in: 'in.iot.dreame.tech:13267',
  de: 'eu.iot.dreame.tech:13267',
  tw: 'cn.iot.dreame.tech:13267',
};

/** Default `country` form-field per region (ISO-3166 alpha-2). */
export const REGION_DEFAULT_COUNTRY: Record<DreameRegion, string> = {
  eu: 'GB',
  us: 'US',
  cn: 'CN',
  ru: 'RU',
  sg: 'SG',
  in: 'IN',
  de: 'DE',
  tw: 'TW',
};

/** Default UI language per region (ISO-639-1). */
export const REGION_DEFAULT_LANG: Record<DreameRegion, string> = {
  eu: 'en',
  us: 'en',
  cn: 'zh',
  ru: 'ru',
  sg: 'en',
  in: 'en',
  de: 'de',
  tw: 'zh',
};

/** Static OAuth2 client credentials baked into the Dreamehome app. */
export const OAUTH_BASIC_AUTH = 'Basic ZHJlYW1lX2FwcHYxOkFQXmR2QHpAU1FZVnhOODg=';

/** App-version fingerprint. Update if a new app version starts requiring it. */
export const APP_META = 'cv=i_829';

/** User-Agent the Flutter Dreamehome app sends. */
export const APP_USER_AGENT = 'Dart/3.2 (dart:io)';

/** Tenant id — Dreame brand. */
export const TENANT_DREAME = '000000';
/** Tenant id — Mova brand. */
export const TENANT_MOVA = '000002';

/**
 * Literal value placed in the `from` field of every command envelope. Dreame's
 * cloud ignores it — the original Flutter app sends "XXXXXX" verbatim.
 */
export const COMMAND_FROM_FIELD = 'XXXXXX';

/** `iotComPrefix` path component (/dreame-iot-com-<n>/) for Dreame. */
export const IOT_COM_PREFIX_DREAME = 10000;
/** `iotComPrefix` for Mova brand requests (untested). */
export const IOT_COM_PREFIX_MOVA = 20000;

/** Standard HTTP content types used by the Dreame backend. */
export const CONTENT_TYPE_JSON = 'application/json';
export const CONTENT_TYPE_FORM = 'application/x-www-form-urlencoded';
