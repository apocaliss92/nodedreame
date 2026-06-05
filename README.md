# nodedreame

Node.js/TypeScript client for Dreame robot vacuums and mowers via the Dreamehome cloud.

> Work in progress. Unified, event-driven library — not a UI.

## Status

Phase 2 complete: log in, discover devices, and drive each device through a
generic handle (property cache + live MQTT updates + raw MIoT reads/writes/
actions). Vacuum- and mower-specific feature methods, value enums, and map
decoding are not implemented yet (Phase 3+).

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

> The library exposes only generic MIoT primitives in Phase 2:
> `refreshProperties` / `getProperty` (cache) / `setProperty` / `callAction`.
> Typed vacuum (`start`/`dock`/zones) and mower (`startMowing`/schedules)
> handles, plus live maps, arrive in later phases.

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
