// Public API surface of nodedreame.
// Phase 1 exports only the error classes and core domain types; transport,
// cloud and model internals stay private to keep the published surface small
// and stable. The high-level facade is added in Phase 2.

export { LIBRARY_NAME } from './support/version.js';

// Stable public surface for Phase 1: error classes + core types. The full
// facade (login/discoverDevices) is added in Phase 2 — we intentionally do
// not export transport internals here to keep the published API small.

export {
  DreameError,
  DreameAuthError,
  DreameApiError,
  DreameDeviceOfflineError,
  DreameTransportError,
} from './transport/errors.js';

export type { DreameRegion } from './auth/config.js';
export type {
  DreameSession,
  DreameDevice,
  DreameCloudState,
  MiotProp,
  MiotAction,
  PropertyWrite,
  PropertyResult,
} from './cloud/types.js';

// --- Phase 2: high-level facade + generic device handle ------------------
export { Nodreame } from './api/nodreame.js';
export type { NodreameDeps, CreateDeviceArgs, NodreameEvents } from './api/nodreame.js';
export { BaseDevice } from './device/base-device.js';
export type { BaseDeviceEvents } from './device/base-device.js';
export { DefaultCapabilityResolver, resolveCapabilities } from './device/capability.js';
export type { CapabilityResolver, DeviceCapabilities } from './device/capability.js';
export type {
  NodreameOptions,
  PropertyState,
  PropertyChangedEvent,
  StateChangedEvent,
  DeviceEvent,
} from './api/types.js';
