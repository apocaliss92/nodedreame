# nodedreame

Node.js/TypeScript client for Dreame robot vacuums and mowers via the Dreamehome cloud.

> Work in progress. Unified, event-driven library — not a UI.

## Status

Phase 3 complete: on top of the Phase 2 generic handle, `discoverDevices()` now
returns a typed `VacuumDevice` for `dreame.vacuum.*` models, with decoded state
getters (status, battery, suction, water, cleaning mode, faults, consumables)
and capability-gated commands. Mower-specific handles (Phase 4) and live map
decoding (Phase 5) are not implemented yet.

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
import { Nodreame } from 'nodedreame';

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
import { Nodreame, VacuumDevice, SuctionLevel } from 'nodedreame';

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

The error classes and core domain types are also exported so consumers can catch
and type cloud failures:

```ts
import {
  DreameError,
  DreameAuthError,
  DreameApiError,
  DreameDeviceOfflineError,
  DreameTransportError,
} from 'nodedreame';
import type { DreameSession, DreameDevice, MiotProp } from 'nodedreame';
```

## Install

```bash
npm install nodedreame
```

## License

MIT. Ports prior work from [Tasshack/dreame-vacuum](https://github.com/Tasshack/dreame-vacuum),
[antondaubert/dreame-mower](https://github.com/antondaubert/dreame-mower), and
[malard/node-dreame](https://github.com/malard/node-dreame); see `LICENSE`.
