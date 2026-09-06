/**
 * Connectivity / diagnostic info distilled from a device-list record.
 *
 * Scope note: the Dreame cloud device record exposes reachability + identity +
 * the assigned MQTT broker, but NOT Wi-Fi RSSI / SSID / local IP — those are
 * native-firmware (miIO-style) details the cloud API does not return for these
 * vacuums. So `signalStrength`/`ssid`/`ip` are intentionally absent here; this
 * surfaces everything the cloud actually provides.
 */

/** The device's assigned MQTT broker endpoint (from `bindDomain`). */
export interface BrokerEndpoint {
  readonly host: string;
  readonly port: number | null;
}

export interface DeviceConnectivity {
  /** Whether the cloud considers the device online (LWT/online flag). */
  readonly online: boolean;
  /** Physical link type reported by the cloud (e.g. `"WIFI"`), or null. */
  readonly connectionType: string | null;
  /** Device MAC address, or null. */
  readonly mac: string | null;
  /** Assigned MQTT broker (`bindDomain` split into host/port), or null. */
  readonly broker: BrokerEndpoint | null;
  /** Cloud region the device is bound to (e.g. `"eu"`), or null. */
  readonly region: string | null;
  /** Cloud media/IoT vendor (e.g. `"ali"`), or null. */
  readonly cloudVendor: string | null;
  /** Firmware version (`ver`), or null. */
  readonly firmwareVersion: string | null;
  /** Serial number (`sn`), or null. */
  readonly serialNumber: string | null;
  /** Sub-model code, or null. */
  readonly subModel: string | null;
  /** Battery percentage 0–100 from the cloud snapshot, or null. */
  readonly battery: number | null;
  /** Latest MIoT status int from the cloud snapshot, or null. */
  readonly statusCode: number | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Split a `bindDomain` like `"10000.mt.eu.iot.dreame.tech:19973"` into host/port. */
function parseBroker(bindDomain: unknown): BrokerEndpoint | null {
  const s = str(bindDomain);
  if (!s) return null;
  const idx = s.lastIndexOf(':');
  if (idx < 0) return { host: s, port: null };
  const port = Number(s.slice(idx + 1));
  return { host: s.slice(0, idx), port: Number.isFinite(port) ? port : null };
}

/** Parse the connectivity view from a raw device-list record. */
export function parseConnectivity(raw: Record<string, unknown>): DeviceConnectivity {
  const deviceInfo = (raw['deviceInfo'] ?? {}) as Record<string, unknown>;
  return {
    online: raw['online'] === true,
    connectionType: str(deviceInfo['scType']),
    mac: str(raw['mac']),
    broker: parseBroker(raw['bindDomain']),
    region: str(raw['region']),
    cloudVendor: str(raw['vendor']),
    firmwareVersion: str(raw['ver']),
    serialNumber: str(raw['sn']),
    subModel: str(raw['subModel']),
    battery: numOrNull(raw['battery']),
    statusCode: numOrNull(raw['latestStatus']),
  };
}
