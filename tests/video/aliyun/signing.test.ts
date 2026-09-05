import { describe, it, expect } from 'vitest';
import { signApiGatewayRequest } from '../../../src/video/aliyun/signing.js';

// Byte-for-byte vector captured from the official app's connect.json request.
const APPKEY = '33974273';
const APPSECRET = '65a62f03ae5eda97af962fecc2e3efa6';
const REQUEST_VALUE =
  '{"context":{"appKey":"33974273","deviceId":"ea17b541-18a1-4af3-9c6d-d5fccb883001","platformName":"iOS","netType":"wifi","sdkVersion":"3.4.0.27","appID":"com.dreame.smarthome","appVersion":"1895","utDid":"Zo0Nca4ZG8oDAOqz7bi\\/osv5"},"config":{"version":0,"lastModify":1720520051}}';

describe('signApiGatewayRequest', () => {
  it('reproduces the captured connect.json x-ca signature (form body)', () => {
    const { headers, body } = signApiGatewayRequest({
      method: 'POST',
      host: 'living-account.eu-central-1.aliyuncs.com',
      path: '/api/prd/connect.json',
      appKey: APPKEY,
      appSecret: APPSECRET,
      form: { request: REQUEST_VALUE },
      nonce: '2328F056-6C01-40DB-BFAD-AE65F01ACDFF',
      timestamp: 1788616786836,
      date: 'Sat, 05 Sep 2026 15:59:46 GMT+2',
    });
    expect(headers['X-Ca-Signature']).toBe('WycVfNYRw449xR2OVeiQuHgpwgU=');
    expect(headers['X-Ca-Key']).toBe(APPKEY);
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded; charset=UTF-8');
    // form value is URL-encoded in the wire body
    expect(body.startsWith('request=%7B%22context%22')).toBe(true);
  });

  it('includes Content-MD5 and extra Stage header for a JSON body', () => {
    const { headers, body } = signApiGatewayRequest({
      method: 'POST',
      host: 'eu-central-1.api-iot.aliyuncs.com',
      path: '/vision/customer/stream/query',
      appKey: APPKEY,
      appSecret: APPSECRET,
      json: { hello: 'world' },
      extraCaHeaders: { 'X-Ca-Stage': 'RELEASE' },
    });
    expect(headers['Content-MD5']).toBeTruthy();
    expect(headers['X-Ca-Signature-Headers']).toContain('X-Ca-Stage');
    expect(headers['X-Ca-Signature']).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(body).toBe('{"hello":"world"}');
  });
});
