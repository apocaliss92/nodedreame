import type { DeviceInfoRecord } from './schemas.js';
import type { DeviceVideoProfile, VideoVendor } from './types.js';

const KNOWN_VENDORS: readonly string[] = ['tx', 'ali'];

function asVendor(v: string | undefined | null): VideoVendor | null {
  return v === 'tx' || v === 'ali' ? v : null;
}

/** Parse the stringified `property` blob for the fields we care about (iotId, lwt). */
function parseProperty(property: string | undefined): { iotId: string | null; lwt: number | null } {
  if (!property) {
    return { iotId: null, lwt: null };
  }
  try {
    const p = JSON.parse(property) as { iotId?: unknown; lwt?: unknown };
    return {
      iotId: typeof p.iotId === 'string' && p.iotId.length > 0 ? p.iotId : null,
      lwt: typeof p.lwt === 'number' ? p.lwt : null,
    };
  } catch {
    return { iotId: null, lwt: null };
  }
}

/**
 * Derive a {@link DeviceVideoProfile} from a raw device record. Pure — no I/O —
 * so it is unit-testable against captured records. `videoCapable` is true when
 * the cloud marks the device `permit: "video"` or lists any supported vendor.
 */
export function toVideoProfile(record: DeviceInfoRecord): DeviceVideoProfile {
  const info = record.deviceInfo ?? {};
  const supportedVendors = (info.defaultVendors ?? []).filter((v): v is VideoVendor =>
    KNOWN_VENDORS.includes(v),
  );
  const prop = parseProperty(record.property);
  const online = record.online === true || record.lwt === 1 || prop.lwt === 1;
  return {
    did: String(record.did ?? ''),
    model: String(record.model ?? info.model ?? ''),
    displayName: info.displayName ?? null,
    videoCapable: info.permit === 'video' || supportedVendors.length > 0,
    currentVendor: asVendor(record.vendor),
    supportedVendors,
    dynamicVendor: info.videoDynamicVendor === true,
    iotId: prop.iotId,
    online,
  };
}
