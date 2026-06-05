import { BaseDevice } from '../device/base-device.js';
import { VacuumDevice } from '../models/vacuum/vacuum-device.js';
import { MowerDevice } from '../models/mower/mower-device.js';
import { VACUUM_ACTION } from '../models/vacuum/properties.js';
import { MOWER_ACTION } from '../models/mower/properties.js';
import type { DeviceDump } from './dump-format.js';

/** The `catalog` slice of a {@link DeviceDump}. */
type DumpCatalog = DeviceDump['catalog'];
type DumpCommand = NonNullable<DumpCatalog['commands']>[number];

/**
 * Build the STATIC catalog for a device: its declared command/action map +
 * resolved capability tokens. Reads only static maps + the capability getter —
 * NEVER invokes an action. Cast-free: the `*_ACTION` maps are plain records of
 * `{ siid, aiid }`, iterated with `Object.entries`.
 */
export function buildCatalog(device: BaseDevice): DumpCatalog {
  const commands: DumpCommand[] = [];
  if (device instanceof VacuumDevice) {
    for (const [name, ref] of Object.entries(VACUUM_ACTION)) {
      commands.push({ name, siid: ref.siid, aiid: ref.aiid });
    }
  } else if (device instanceof MowerDevice) {
    for (const [name, ref] of Object.entries(MOWER_ACTION)) {
      commands.push({ name, siid: ref.siid, aiid: ref.aiid });
    }
  }
  const tokens = device.capabilities.list();
  return {
    commands,
    capabilities: { tokens: [...tokens] },
  };
}
