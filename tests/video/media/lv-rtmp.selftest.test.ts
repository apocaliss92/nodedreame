import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LvRtmpClient, LV_STATUS } from '../../../src/video/media/lv-rtmp-client.js';
import { ChunkReader } from '../../../src/video/media/chunk.js';
import { decodeAmf0 } from '../../../src/video/media/amf0.js';

// Byte-exact guard: the RTMP private-mode encoder must reproduce the app's
// opening sequence from the captured client streams, and the chunk reader must
// decode both the app (unchunked) and robot (ext-timestamp) captures. Fixtures
// are the raw TCP payloads (client->relay) extracted from the wake pcaps.
const HANDSHAKE_LEN = 1537;
const HOST = 'rtmp://iotx-vision-streaming-rtmp-eu-central-1.aliyuncs.com:8000';
const PLAYPATH = 'WmYXdsEA5FBup4VFrwDFE5r4IVS-ploNp2KLu5abwTY_0';

const fixture = (name: string): Buffer =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));

const CAPTURES = [
  { file: 'app_dreame.bin', token: '03c903541a3a4871ac1d18e009c49bb2', session: 'c4c650ae6b2b4cacbd564d3afeff07de' },
  { file: 'app_dr3.bin', token: '212f29e35d2f4bf3934718714cdadbfb', session: '871b315d25f9403b9c1e7ec14b4c410c' },
];

describe('lv-rtmp byte-exact self-test', () => {
  it.each(CAPTURES)('encoder reproduces the app opening sequence: $file', ({ file, token, session }) => {
    const captured = fixture(file);
    const expected = captured.subarray(HANDSHAKE_LEN); // connect + play + RequestAudioType + Ping.Start
    const client = new LvRtmpClient({ url: `${HOST}/live?token=${token}&session=${session}/${PLAYPATH}` });
    const produced = Buffer.concat([...client.buildOpeningSequence(), client.buildStatus(LV_STATUS.PING_START)]);
    expect(produced.equals(expected)).toBe(true);
  });

  it('chunk reader decodes the app capture (unchunked): types start 20,20,20,20', () => {
    const buf = fixture('app_dreame.bin').subarray(HANDSHAKE_LEN);
    const reader = new ChunkReader();
    const msgs: ReturnType<ChunkReader['feed']> = [];
    for (let i = 0; i < buf.length; i += 7) msgs.push(...reader.feed(buf.subarray(i, i + 7)));
    expect(msgs.slice(0, 4).map((m) => m.type)).toEqual([20, 20, 20, 20]);
    // First message is the AMF0 `connect` command.
    expect(decodeAmf0(msgs[0]!.body)[0]).toBe('connect');
  });

  it('chunk reader decodes the robot capture (ext timestamps): types start 20,20,18,8,8', () => {
    const buf = fixture('robot_dreame.bin').subarray(HANDSHAKE_LEN);
    const reader = new ChunkReader();
    const msgs: ReturnType<ChunkReader['feed']> = [];
    for (let i = 0; i < buf.length; i += 7) msgs.push(...reader.feed(buf.subarray(i, i + 7)));
    expect(msgs.slice(0, 5).map((m) => m.type)).toEqual([20, 20, 18, 8, 8]);
  });
});
