import { createHash, createHmac } from 'node:crypto';

/**
 * Aliyun API Gateway ("x-ca") request signing, HmacSHA1. Used by the LinkVisual
 * video endpoints the Dreamehome app talks to (living-account + api-iot hosts).
 *
 * The string to sign is:
 *   METHOD\n Accept\n Content-MD5\n Content-Type\n Date\n <signed-headers-block> <resource>
 * where the signed-headers block is `Name:Value\n` for each header named in
 * `X-Ca-Signature-Headers`, sorted case-insensitively, and `resource` is the
 * path plus, for form bodies, the `?`-joined sorted form params.
 *
 * Verified byte-for-byte against a captured connect.json request (see tests).
 */

export interface SignedRequest {
  headers: Record<string, string>;
  body: string;
}

export interface SignInput {
  method: 'POST' | 'GET';
  host: string;
  path: string;
  appKey: string;
  appSecret: string;
  /** JSON payload → sent as the raw body with a Content-MD5. */
  json?: unknown;
  /** Form fields → sent as application/x-www-form-urlencoded and folded into the resource. */
  form?: Record<string, string>;
  /** Extra x-ca headers to sign (e.g. `{ 'X-Ca-Stage': 'RELEASE' }`). */
  extraCaHeaders?: Record<string, string>;
  /** Overrides for deterministic tests. */
  nonce?: string;
  timestamp?: number;
  date?: string;
}

const CT_JSON = 'application/json; charset=UTF-8';
const CT_FORM = 'application/x-www-form-urlencoded; charset=UTF-8';

function md5Base64(s: string): string {
  return createHash('md5').update(s, 'utf8').digest('base64');
}

/** Build the x-ca headers + body for a request. */
export function signApiGatewayRequest(input: SignInput): SignedRequest {
  const accept = CT_JSON;
  const contentType = input.json !== undefined ? CT_JSON : CT_FORM;
  const date = input.date ?? new Date().toUTCString();

  let body: string;
  let contentMd5 = '';
  let formParams: Record<string, string> | undefined;
  if (input.json !== undefined) {
    body = JSON.stringify(input.json);
    contentMd5 = md5Base64(body);
  } else {
    const form = input.form ?? {};
    body = Object.entries(form)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    formParams = form;
  }

  const caHeaders: Record<string, string> = {
    'X-Ca-Key': input.appKey,
    'X-Ca-Nonce': input.nonce ?? crypto.randomUUID().toUpperCase(),
    'X-Ca-Timestamp': String(input.timestamp ?? Date.now()),
    'X-Ca-Version': '1',
    ...(input.extraCaHeaders ?? {}),
  };

  const signedHeaderNames = Object.keys(caHeaders).sort((a, b) =>
    a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0,
  );
  const headerBlock = signedHeaderNames.map((k) => `${k}:${caHeaders[k]}\n`).join('');

  let resource = input.path;
  if (formParams && Object.keys(formParams).length > 0) {
    const sorted = Object.keys(formParams).sort();
    resource += '?' + sorted.map((k) => `${k}=${formParams[k]}`).join('&');
  }

  const stringToSign = `${input.method}\n${accept}\n${contentMd5}\n${contentType}\n${date}\n${headerBlock}${resource}`;
  const signature = createHmac('sha1', input.appSecret).update(stringToSign, 'utf8').digest('base64');

  const headers: Record<string, string> = {
    'Content-Type': contentType,
    Accept: accept,
    Date: date,
    'X-Ca-Signature': signature,
    'X-Ca-Signature-Method': 'HmacSHA1',
    'X-Ca-Signature-Headers': signedHeaderNames.join(','),
    ...caHeaders,
  };
  if (contentMd5) {
    headers['Content-MD5'] = contentMd5;
  }
  return { headers, body };
}
