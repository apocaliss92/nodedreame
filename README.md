# nodedreame

Node.js/TypeScript client for Dreame robot vacuums and mowers via the Dreamehome cloud.

> Work in progress. Unified, event-driven library — not a UI.

## Status

`discoverDevices()` returns a typed `VacuumDevice` for `dreame.vacuum.*` models
and a typed `MowerDevice` for `dreame.mower.*` models, each with decoded state
getters and capability-gated commands. On top of that:

- **Maps** — live vacuum map decode (I/P-frame stream) + PNG render, mower map + SVG.
- **Connectivity** — per-device online/link-type/broker/firmware/serial view
  ([Connectivity](#connectivity)).
- **WiFi signal** — the robot's WiFi coverage heatmap, sampled at the robot's
  pose for a current-signal reading ([WiFi signal](#wifi-signal)).
- **Camera & video** (X40/X50 class) — autonomous cold-start of the LinkVisual
  RTMP stream with H.264+AAC frame output, camera actions (drive/presets/sounds/
  light), object detections, and two-way intercom
  ([Camera & video streaming](#camera--video-streaming)).

Under the hood:

- OAuth password-grant login with proactive token refresh (the shared session
  is refreshed ~100s before expiry, and every device's MQTT push is
  re-authenticated with the new token transparently).
- Per-device MQTT push with **durable reconnect** — it reconnects with backoff
  on an unexpected drop and rebuilds the connection with a fresh token on
  refresh. A `get_properties` poll fallback runs only while the push is down and
  stops once it reconnects.
- All cloud and MQTT responses are validated with `zod` at the boundary, so a
  malformed response fails fast with a clear error instead of propagating
  `undefined`.

## Usage

```ts
import { Nodreame } from '@apocaliss92/nodedreame';

const client = new Nodreame({
  username: process.env.DREAME_USERNAME!,
  password: process.env.DREAME_PASSWORD!,
  region: 'eu',
});

await client.login();
const devices = await client.discoverDevices();

for (const device of devices) {
  console.log(device.deviceId, device.model, device.name);

  // Live-read a couple of MIoT properties (siid.piid are model-specific).
  await device.refreshProperties([{ siid: 2, piid: 1 }]);
  console.log('state:', device.getProperty(2, 1)?.value);

  // React to pushed updates.
  device.on('stateChanged', (e) => console.log('changed', e.changes));
}

// The shared session auto-refreshes ~100s before expiry; every device's MQTT
// push is re-authenticated with the new token transparently.

await client.close(); // closes all pushes, clears all timers
```

> The generic MIoT primitives stay available on every handle:
> `refreshProperties` / `getProperty` (cache) / `setProperty` / `callAction`.
> Mower (`startMowing`/schedules) handles and live maps arrive in later phases.

## Vacuums

For `dreame.vacuum.*` models, `discoverDevices()` returns a `VacuumDevice` (a
subclass of the generic handle), which adds typed, decoded state getters and
capability-gated commands on top of the raw MIoT primitives.

```ts
import { Nodreame, VacuumDevice, SuctionLevel } from '@apocaliss92/nodedreame';

const client = new Nodreame({
  username: process.env.DREAME_USERNAME!,
  password: process.env.DREAME_PASSWORD!,
  region: 'eu',
});

await client.login();
const devices = await client.discoverDevices();

const vacuum = devices.find((d): d is VacuumDevice => d instanceof VacuumDevice);
if (vacuum) {
  // Seed the cache with the vacuum's known properties (one live read).
  await vacuum.refreshProperties([...VacuumDevice.DEFAULT_PROPS]);

  // Typed, decoded state. Each getter returns null until the matching
  // property has landed (via the seed read above or a pushed update).
  console.log('status:', vacuum.status); // MiotState | null
  console.log('battery:', vacuum.battery); // number | null (%)
  console.log('suction:', vacuum.suction); // SuctionLevel | null
  console.log('water:', vacuum.water); // WaterVolume | null
  console.log('docked:', vacuum.isDocked);
  console.log('faults:', vacuum.faults); // number[]

  // Capability-gated commands (all async).
  await vacuum.setSuction(SuctionLevel.Max);
  await vacuum.startCleaning(); // begins a clean (NOT the lifecycle start())
  // await vacuum.pause();
  // await vacuum.stop();
  // await vacuum.dock();         // return to dock / charge
  // await vacuum.locate();       // make the robot beep
  // await vacuum.cleanSegments([1, 2]); // per-room, gated by canCleanPerRoom
}

await client.close();
```

> **`startCleaning()`, not `start()`.** `start()` is the inherited lifecycle
> method that opens the MQTT push; the cleaning command is `startCleaning()`.
> All command methods are `async`.

### Honest caveats

- **State getters return `null` until data lands.** Call
  `refreshProperties([...VacuumDevice.DEFAULT_PROPS])` (or wait for a pushed
  update) before reading; an unseeded getter is `null`, and an out-of-range raw
  value also decodes to `null` (the raw integer is still available via the
  `*Raw` getters, e.g. `vacuum.suctionRaw`).
- **`r2538z` capabilities are assumed, not verified.** The user's
  `dreame.vacuum.r2538z` capability record is mirrored from its `r2532a` (X50)
  sibling, so `vacuum.vacuumCapabilities.verified === false`. Treat its feature
  flags as a best-effort hypothesis until confirmed on-device.
- **Clean-mode writes are safe by construction.** `setCleaningMode()` writes the
  plain `CLEAN_MODE_SETTING` property (siid 2 piid 6); the raw `0x1400`-masked
  bitfield (siid 4 piid 23) is read-only here and never written directly.
- **Some action mappings are assumed.** `pause`/`stop`/`locate`/`clearWarning`
  are wire-verified on the r2532a sibling; `startCleaning`/`dock` and the
  targeted-clean payloads (`cleanSegments`/`cleanZones`/`cleanSpot`) are ported
  from Tasshack and not yet live-verified across all models.
- **No map-derived state yet.** Per-room/current-segment data and live maps come
  from the map layer (Phase 5); they are not exposed in Phase 3.

## Mowers

For `dreame.mower.*` models, `discoverDevices()` returns a `MowerDevice` (a
subclass of the generic handle) with typed, decoded state getters and
capability-gated commands, mirroring the vacuum surface.

```ts
import { Nodreame, MowerDevice } from '@apocaliss92/nodedreame';

const client = new Nodreame({
  username: process.env.DREAME_USERNAME!,
  password: process.env.DREAME_PASSWORD!,
  region: 'eu',
});

await client.login();
const devices = await client.discoverDevices();

const mower = devices.find((d): d is MowerDevice => d instanceof MowerDevice);
if (mower) {
  // Seed the cache with the mower's known properties (one live read).
  await mower.refreshProperties([...MowerDevice.DEFAULT_PROPS]);

  // Typed, decoded state. Each getter returns null until the matching
  // property has landed (via the seed read above or a pushed update).
  console.log('status:', mower.status); // MowerStatus | null
  console.log('battery:', mower.battery); // number | null (%)
  console.log('charging:', mower.charging); // MowerChargingStatus | null
  console.log('docked:', mower.isDocked); // boolean
  console.log('mowing:', mower.isMowing); // boolean
  console.log('task:', mower.task); // MowerTaskDescriptor | null (2:50)
  console.log('coverage target %:', mower.coverageTargetPct); // number | null
  console.log('control action:', mower.controlAction); // MowerControlAction | null

  // Capability-gated commands (all async).
  await mower.startMowing(); // begins mowing (NOT the lifecycle start())
  // await mower.pause();
  // await mower.stop();
  // await mower.dock();   // return to dock / charge
  // await mower.resume(); // resume after a pause (continueControl opcode)
  // Targeted starts (gated by the model's capability flags):
  // await mower.startMowingAllArea(mapId);   // whole map
  // await mower.startMowingZones([1, 3]);    // selected zones
  // await mower.startMowingEdges([[1, 0]]);  // edge / contour pairs
  // await mower.startMowingSpots([5]);       // spot areas
}

await client.close();
```

> **`startMowing()`, not `start()`.** `start()` is the inherited lifecycle
> method that opens the MQTT push; the mowing command is `startMowing()`. All
> command methods are `async`.

### Honest caveats

- **State getters return `null` until data lands.** Call
  `refreshProperties([...MowerDevice.DEFAULT_PROPS])` (or wait for a pushed
  update) before reading; an unseeded getter is `null`, and an out-of-range raw
  value also decodes to `null` (the raw integer is still available via the
  `*Raw` getters, e.g. `mower.statusRaw`, `mower.chargingRaw`,
  `mower.taskStatusRaw`).
- **`dreame.mower.p2255` (Dreame A1) capabilities are assumed, not verified.**
  The donor integration has no per-model mower capability matrix, so the
  targeted-mowing flags are a conservative hypothesis from its command surface;
  `mower.mowerCapabilities.verified === false` until confirmed on-device.
  Unsupported targeted starts throw `DreameError`.
- **Progress is a coverage scalar, not a map track.** `coverageTargetPct`
  surfaces the scheduling-task descriptor's coverage target (`d.o`, 2:50); the
  byte-accurate pose/coverage track geometry and live maps come from the map
  layer (Phase 5) and are not decoded here.

The error classes and core domain types are also exported so consumers can catch
and type cloud failures:

```ts
import {
  DreameError,
  DreameAuthError,
  DreameApiError,
  DreameDeviceOfflineError,
  DreameTransportError,
} from '@apocaliss92/nodedreame';
import type { DreameSession, DreameDevice, MiotProp } from '@apocaliss92/nodedreame';
```

## Maps

Both device families decode their on-device map and render it to an image. The
binary/JSON decoders, the OSS signed-blob fetcher and every intermediate step
stay private — you obtain maps through the device handles and (optionally) the
two renderers.

### Vacuum map → PNG

`VacuumDevice.getMap()` resolves a saved/live map blob, decrypts and inflates
the binary envelope, parses the 27-byte header and the `fsm:1` pixel grid, and
returns a structured `VacuumMap` — segments/rooms, the cleaning path, AI
obstacles, virtual walls, no-go / no-mop zones, sneak zones, per-room walls and
the cleaned-area overlay. `renderVacuumPng(map)` rasterises it to a PNG
`Buffer` via `pngjs`.

```ts
import { renderVacuumPng } from '@apocaliss92/nodedreame';
import type { VacuumMap } from '@apocaliss92/nodedreame';
import { writeFile } from 'node:fs/promises';

// `filename` is the OSS object name advertised on the map PATH push (siid 6,
// piid 3); resolve it from a `mapInfo` push before calling getMap().
const map: VacuumMap = await vacuum.getMap({ filename });
const png = renderVacuumPng(map); // Buffer (optional { scale } upscale)
await writeFile('map.png', png);

// The most-recently-decoded map is cached, and the active room id is derived:
vacuum.lastMap; // VacuumMap | null
vacuum.currentSegmentId; // number | null (id of the active segment)
```

> **Live map data requires an awake robot.** A sleeping vacuum returns no fresh
> blob. `getMap()` decodes a single frame; continuous live-frame **P-frame
> streaming** (merging delta frames as the robot moves) is a documented
> follow-up — the `applyVacuumPFrame` merge primitive ships and is unit-tested,
> so that work is additive, not a rewrite.

### Mower map → SVG

`MowerDevice.getMap()` reassembles the batched `MAP.*` / `M_PATH.*` JSON chunks
and parses them into a `MowerMap` — zones, spot areas, forbidden areas,
navigation paths, contours, mow-path tracks and the map boundary.
`mower.mapSvg()` (or the free `renderMowerSvg(map)`) renders a deterministic SVG
string of the geometry.

```ts
import { renderMowerSvg } from '@apocaliss92/nodedreame';
import type { MowerMap } from '@apocaliss92/nodedreame';
import { writeFile } from 'node:fs/promises';

const map: MowerMap = await mower.getMap();
const svg = await mower.mapSvg(); // or renderMowerSvg(map)
await writeFile('map.svg', svg);
```

> **Same awake-robot caveat.** A sleeping mower returns no fresh batch.
> Additionally, the concrete **live batch-fetch cloud endpoint is a documented
> follow-up**: its path is obfuscated in the donor integration and not yet
> recovered, so the default fetcher throws (`getMap()` then rejects). The map
> **parser and SVG renderer are fully shipped and unit-tested** against batch
> fixtures, and `MowerDevice` accepts an injected batch fetcher seam, so a
> caller that already knows the path can drive a live map today.

### Attribution

The vacuum map decoder is ported from
[malard/node-dreame](https://github.com/malard/node-dreame); the mower map
parser and SVG renderer from
[antondaubert/dreame-mower](https://github.com/antondaubert/dreame-mower). Both
are MIT — see `LICENSE`.

## Connectivity

Every `DreameDevice` from `listDevices()` (and the records behind
`discoverDevices()`) carries a distilled connectivity view — everything the
Dreame cloud actually reports:

```ts
import { listDevices } from '@apocaliss92/nodedreame';

for (const d of await listDevices({ session, region: 'eu' })) {
  console.log(d.name, d.connectivity);
  // {
  //   online: true,
  //   connectionType: 'WIFI',            // or 'BLE' (mowers)
  //   mac, broker: { host, port },       // assigned MQTT broker (bindDomain)
  //   region, cloudVendor, firmwareVersion, serialNumber, subModel,
  //   battery, statusCode
  // }
}
```

`parseConnectivity(rawRecord)` is exported for parsing a record you already hold.
Note: the cloud record does **not** expose Wi-Fi RSSI / SSID / local IP — those
are native-firmware only. For signal strength use the WiFi map below.

## WiFi signal

The robot has no live RSSI property; its only signal data is a **WiFi coverage
map** it builds while cleaning. nodedreame fetches the **last stored** map (no
robot movement — the same thing the app shows), decodes the per-cell signal
level, and — since the map header carries the robot pose — reports the signal at
the robot's current position.

```ts
const bars = await vacuum.getCurrentSignal();       // 0–4 (0 = unreached), or null
const png  = await vacuum.getWifiSignalImage();     // Buffer: heatmap PNG (ready to show)
const map  = await vacuum.getWifiSignalMap();       // full data:
//   map.dimensions {left,top,width,height,gridSize}
//   map.robot / map.dock  (poses, mm world frame)
//   map.cells            (Uint8Array, raw nibble per cell)
//   map.signalAt(x, y)   -> bars 1–4 / 0 unreached / null (no data / off-map)
//   map.currentSignal    -> bars at the robot pose
```

Each call issues `requestWMap` (map service action `6/4`) to (re)fetch the last
stored map, polls `PropWifiMap` (`6/15`) for the OSS object, and decodes it via
the normal signed-OSS map pipeline. Signal levels: `10` unreached, `11`–`14` =
1–4 bars. Throws if the device has never built a WiFi map.

## Camera & video streaming

For camera-equipped vacuums (X40/X50 class, LinkVisual/Aliyun backend),
nodedreame **autonomously cold-starts the live stream** — no Dreamehome app — and
emits demuxed H.264 + AAC frames any consumer (ffmpeg, scrypted, camstack) can
use.

### How it works (high level)

```
DreameCameraController.open()          DreameCameraStream            consumer
─────────────────────────────         ──────────────────           ────────
1. getAccessCodeLaunch (prime)   ┐
2. initCameraSdk (boot agent)    │  MIoT actions on siid 10001
3. startMonitor  ── code -1 ─────┤  over the device's MQTT channel
4. verifyAccessCode(sha256 PIN)  │  (the camera has a per-session
5. startMonitor (retry) ── ok ───┘  privacy gate: PIN is mandatory)
6. keep-alive loop (~10s)                    │
7. stream/query (Aliyun) → RTMP relay URL ───┤
                                             ▼
                              LvRtmpClient connects to the relay
                              (private-mode RTMP), demuxes FLV →
                              emits: videoAccessUnit (H.264 Annex-B),
                                     audioFrame (AAC/ADTS), audioInfo
                                             │
                                             ▼  (scrypted wraps these as RFC4571;
                                                camstack consumes frames directly)
```

The **access-code gate** is the key device quirk: a bare `startMonitor` returns
`code:-1`; you must first `verifyAccessCode` with the SHA-256 of the pairing PIN,
then `startMonitor` is accepted and the Aliyun relay mints an RTMP URL. The whole
sequence, keep-alive, and teardown are handled by `DreameCameraController`.

### Quick start

```ts
const controller = await vacuum.createCameraController({ accessCode: '0000' });
const { rtmpUrl } = await controller.open();   // cold-start → live relay URL (H.264+AAC)
// … hand rtmpUrl to ffmpeg, or use DreameCameraStream for frames …
await controller.close();                      // stops keep-alive + releases the monitor
```

Frame-level pipeline (what camstack/scrypted build on):

```ts
import { DreameCameraStream } from '@apocaliss92/nodedreame';

const stream = new DreameCameraStream({ controller });
stream.on('videoAccessUnit', (au) => { /* au.data = H.264 Annex-B, au.isKeyframe */ });
stream.on('audioFrame', (buf) => { /* AAC ADTS */ });
await stream.start();   // cold-start + connect + emit frames
// … later …
await stream.stop();
```

### Camera actions (control plane)

All on `DreameCameraController`, most gated to an open stream:

| Method | Effect |
| --- | --- |
| `driveDirection('forward'\|'left'\|'right'\|'turnAround'\|'stop')` / `drive(spdv, spdw)` | Remote-drive the robot (send ~1 Hz while held; the camera is fixed, the robot moves) |
| `returnToDock()` · `locate()` | Send home / beep to locate |
| `spotClean()` · `startPersonFollow()` / `stopPersonFollow()` · `findPet()` · `goToPoint(sp, tp)` | Work-mode actions |
| `stopWork()` | Universal stop (follow / spot-clean / cruise) |
| `playPetSound('meow'\|'bark'\|'footsteps'\|'purring'\|'tickTock')` / `playSound(id)` | Play a sound clip |
| `setFillLight(level)` / `setFillLightAuto(full)` | Fill-light brightness / full-light on-off |
| `takePhoto()` | Device-side snapshot (uploads to cloud) |
| `startIntercom()` / `stopIntercom()` | Two-way audio session (control) |
| `runVacuumAction('startClean'\|'pauseClean'\|'stopClean'\|'dockWash'\|'autoEmpty')` | Common whole-robot actions |

### Two-way intercom (talk-back)

The mic uplink is RTMP type-8 audio pushed upstream on the same play session
(G.711 A-law, 8 kHz). On the stream:

```ts
await stream.startTalk();                 // MIoT intercom start + wait for TalkReady
stream.sendTalkPcm(pcm16le8kMono);        // encodes to A-law + pushes upstream
await stream.stopTalk();
```

### Object detections

The robot's own person-follow (`10001/110`) and obstacle (`10001/112`) boxes are
pushed as camera-service properties; parse them with `parsePersonFollow` /
`parseObstacleData` (subscribe to the device's `propertyChanged`).

## Diagnostic dump (read-only)

`nodedreame` can record what a device exposes while it operates and export an
**anonymized** JSON you can attach to a GitHub issue to help map undocumented
codes (e.g. mower `taskStatus` 2/3/10/13). The dumper is strictly **read-only** —
it never sends a command and never wakes the robot to act. It only subscribes to
the device's event stream (`on`/`off`), reads the cache (`getProperty`), and
pulls the cloud shadow (`refreshFromCache`).

```ts
import { Nodreame, createDumper } from '@apocaliss92/nodedreame';

const client = new Nodreame({ username, password, region: 'eu' });
await client.login();
const [device] = await client.discoverDevices();

const dumper = createDumper(device);
await dumper.start(); // hooks the live stream + periodic cloud-shadow read
// ...operate the device normally for a few minutes...
await dumper.stop();

console.log(dumper.exportJson()); // pretty, anonymized — safe to share
await client.close();
```

What it captures: per-property distinct value-sets with an `unmapped` flag
(values that match no known enum — the highest-value signal), MIoT events, and a
static command/capability catalog. What it strips: device/account ids, tokens,
MAC, serial, Wi-Fi/IP, GPS, room names, and any custom device name (all →
`[redacted]`). `firmware`/`region` are omitted (not surfaced by the device
handle yet).

Dump a whole account at once with `createClientDumper(client)`, which returns one
dumper per discovered device:

```ts
import { createClientDumper } from '@apocaliss92/nodedreame';

const dumpers = createClientDumper(client);
await Promise.all(dumpers.map((d) => d.start()));
// ...observe...
await Promise.all(dumpers.map((d) => d.stop()));
const dumps = dumpers.map((d) => d.exportJson());
```

Share the exported JSON in a library issue — maintainers diff it against the enum
tables to label new codes and fold them into the library.

## Install

```bash
npm install @apocaliss92/nodedreame
```

## License

MIT. Ports prior work from [Tasshack/dreame-vacuum](https://github.com/Tasshack/dreame-vacuum),
[antondaubert/dreame-mower](https://github.com/antondaubert/dreame-mower), and
[malard/node-dreame](https://github.com/malard/node-dreame); see `LICENSE`.
