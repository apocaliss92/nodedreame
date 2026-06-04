import type { DreameRegion } from '../auth/config.js';

export interface DreameSession {
  accessToken: string;
  refreshToken?: string | undefined;
  uid: string;
  /** Epoch-ms at which `accessToken` expires (`Date.now() + expires_in*1000`). */
  expiresAt: number;
  region: DreameRegion;
}

export interface DreameDevice {
  did: string;
  model: string;
  name: string;
  mac?: string | undefined;
  online: boolean;
  /** Raw record from the cloud, kept for forward compatibility (incl. bindDomain). */
  raw: Record<string, unknown>;
  firmwareVersion?: string;
  serialNumber?: string;
  cloudState?: DreameCloudState;
}

/** Cloud-cached subset of device state distilled from the device-list response. */
export interface DreameCloudState {
  /** Most-recent MIoT state int (siid 2 piid 1). */
  latestStatus: number | null;
  /** Battery percentage 0-100. */
  battery: number | null;
  /** Camera/LinkVisual session active? Derived from the `videoStatus` JSON string. */
  videoActive: boolean | null;
  /** `featureCode2` capability bitfield. */
  featureCode2: number | null;
}

/** A single MIoT property reference (service + property id). */
export interface MiotProp {
  siid: number;
  piid: number;
}

/** A single MIoT action reference (service + action id) with optional inputs. */
export interface MiotAction {
  siid: number;
  aiid: number;
  in?: unknown[];
}

/** Property write — `MiotProp` plus the value to set. */
export interface PropertyWrite extends MiotProp {
  value: unknown;
}

/** Per-property result returned by the cloud. */
export interface PropertyResult {
  siid: number;
  piid: number;
  value?: unknown;
  code?: number;
  [key: string]: unknown;
}
