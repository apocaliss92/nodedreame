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

// --- Phase 3: vacuum model ------------------------------------------------
// Public vacuum surface only: the typed VacuumDevice handle, its value enums,
// and the capability records/resolver. Internal siid/piid/aiid property maps,
// the model factory's property tables, and the decode helpers stay private.
export { VacuumDevice } from './models/vacuum/vacuum-device.js';
export type { CleanOpts, VacuumGetMapInput } from './models/vacuum/vacuum-device.js';
// Fetcher-injection seam for VacuumDevice.getMap: the interface a custom
// signed-blob fetcher implements, plus its input shape. The concrete
// OssFetcher class and the decode internals stay private.
export type { OssFetcherLike, OssFetchInput } from './models/vacuum/map/index.js';
export {
  MiotState,
  ChargingStatus,
  SuctionLevel,
  WaterVolume,
  CleaningMode,
  MiotError,
  TaskStatus,
} from './models/vacuum/enums.js';
export {
  getVacuumCapabilities,
  VacuumCapabilityResolver,
  MODEL_CAPABILITIES as VACUUM_MODEL_CAPABILITIES,
} from './models/vacuum/capabilities.js';
export type { VacuumCapabilities } from './models/vacuum/capabilities.js';
export {
  AI_FEATURE_BIT,
  AI_FEATURE_JSON_KEY,
  decodeAiFeature,
  encodeAiFeatureWrite,
} from './models/vacuum/ai-detection.js';
export type { DreameAiFeature, AiDetectionRaw } from './models/vacuum/ai-detection.js';
export {
  VACUUM_CONSUMABLES,
  consumableSpec,
} from './models/vacuum/consumables.js';
export type {
  ConsumableSpec,
  ConsumableReading,
  DreameConsumableKey,
} from './models/vacuum/consumables.js';

// --- Phase 4: mower model -------------------------------------------------
// Public mower surface only: the typed MowerDevice handle, its value enums,
// the capability records/resolver, and the parsed task/control types. Internal
// siid/piid/aiid maps, opcode payload builders, decode helpers, and the
// deviceClassFor factory stay private.
export { MowerDevice } from './models/mower/mower-device.js';
// Batch-fetch injection seam for MowerDevice.getMap: the fetcher signature and
// the construction input that carries it. The opcode/decode internals and the
// device-class factory stay private.
export type { BatchDeviceDataFetcher, MowerDeviceInput } from './models/mower/mower-device.js';
export {
  MowerStatus,
  MowerChargingStatus,
  MowerControlAction,
  MowerTaskStatus,
  MowerFault,
} from './models/mower/enums.js';
export {
  getMowerCapabilities,
  MowerCapabilityResolver,
  MODEL_CAPABILITIES as MOWER_MODEL_CAPABILITIES,
} from './models/mower/capabilities.js';
export type { MowerCapabilities } from './models/mower/capabilities.js';
export type { MowerTaskDescriptor, MowerControlState } from './models/mower/decode.js';

// --- Phase 5: maps --------------------------------------------------------
// Public map surface: the structured model types + the two renderers. The
// binary/JSON decoders, the OSS signed-blob fetcher, and every intermediate
// decode step (envelope/header/pixel-grid/path/obstacles/geometry/cleaned-area/
// merge, mower chunk reassembly + parser) stay PRIVATE — consumers obtain maps
// via VacuumDevice.getMap()/currentSegmentId/lastMap and MowerDevice.getMap()/
// mapSvg(), all reachable through the already-exported device handles.
export { renderVacuumPng } from './models/vacuum/map/render.js';
export type { RenderVacuumPngOptions } from './models/vacuum/map/render.js';
export type {
  VacuumMap,
  MapDimensions,
  MapBoundingBox,
  MapPoint,
  MapPose,
  MapRun,
  MapLayer,
  MapLayerType,
  MapSegment,
  MapPath,
  MapPathType,
  MapObstacle,
  MapFrameType,
  MapVirtualWall,
  MapRestrictedArea,
  MapLowLyingArea,
  MapWallsInfo,
  MapStorey,
  MapRoom,
  MapRoomWall,
  MapCleanedAreaOverlay,
} from './models/vacuum/map/types.js';

export { renderMowerSvg } from './models/mower/map/render.js';
export type { RenderMowerSvgOptions } from './models/mower/map/render.js';
export type {
  MowerMap,
  MowerPoint,
  MowerZone,
  MowerSpotArea,
  MowerPathEntry,
  MowerContour,
  MowerMapBoundary,
  MowerMowPath,
  MowerAvailableMap,
} from './models/mower/map/types.js';

// --- Diagnostics: read-only device dump ----------------------------------
// Public surface: the createDumper/createClientDumper factories + the shared
// DeviceDump output type + the options type. The Dumper class, redact(), the
// DeviceDumpSchema, the accumulator, and the per-model decoder/catalog helpers
// stay PRIVATE — consumers build a dump only via the factory.
export { createDumper, createClientDumper } from './diagnostics/dumper.js';
export type { DumperOptions } from './diagnostics/dumper.js';
export type { DeviceDump } from './diagnostics/dump-format.js';
