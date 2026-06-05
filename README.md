# nodedreame

Node.js/TypeScript client for Dreame robot vacuums and mowers via the Dreamehome cloud.

> Work in progress. Unified, event-driven library — not a UI.

## Status

Under active development. See releases for available features.

### Transport (Phase 1)

The transport and auth core is implemented and tested internally. As of Phase 1
the library can, at the module level:

- Log in to the Dreamehome cloud (OAuth password grant) and refresh tokens.
- List the devices bound to the account.
- Dispatch a single MIoT command envelope (get / set properties, call action)
  with the correct array-vs-object `params` shape.
- Connect to and subscribe to the per-device MQTT push channel with **durable
  reconnect** — it reconnects with backoff on an unexpected drop and rebuilds
  the connection with a fresh token on refresh.

All cloud and MQTT responses are validated with `zod` at the boundary, so a
malformed response fails fast with a clear error instead of propagating
`undefined`.

These capabilities live in internal modules for now. The only public exports in
Phase 1 are the error classes and the core domain types (so consumers can catch
and type them):

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

The high-level facade (`login`, device discovery, command helpers) and the
device classes and map support arrive in a later phase.

## Install

```bash
npm install nodedreame
```

## License

MIT. Ports prior work from [Tasshack/dreame-vacuum](https://github.com/Tasshack/dreame-vacuum),
[antondaubert/dreame-mower](https://github.com/antondaubert/dreame-mower), and
[malard/node-dreame](https://github.com/malard/node-dreame); see `LICENSE`.
