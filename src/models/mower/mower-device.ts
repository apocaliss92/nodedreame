import { BaseDevice, type BaseDeviceInput } from '../../device/base-device.js';
import { MOWER_PROP } from './properties.js';
import { MowerChargingStatus, MowerControlAction, MowerStatus } from './enums.js';
import {
  asNum,
  enumLookup,
  parseControlStatus,
  parseTaskDescriptor,
  type MowerControlState,
  type MowerTaskDescriptor,
} from './decode.js';
import {
  MowerCapabilityResolver,
  getMowerCapabilities,
  type MowerCapabilities,
} from './capabilities.js';

const STATUS = enumLookup<MowerStatus>(
  Object.values(MowerStatus).filter((v): v is MowerStatus => typeof v === 'number'),
);
const CHARGING = enumLookup<MowerChargingStatus>(
  Object.values(MowerChargingStatus).filter((v): v is MowerChargingStatus => typeof v === 'number'),
);

/** A typed Dreame-mower handle (state + capability-gated commands). */
export class MowerDevice extends BaseDevice {
  readonly #caps: MowerCapabilities;

  constructor(input: BaseDeviceInput) {
    super({
      ...input,
      // Inject the mower resolver so the inherited generic `capabilities` getter
      // carries the mower token set (no banned cast).
      capabilities: input.capabilities ?? new MowerCapabilityResolver().resolve(input.device.model),
    });
    this.#caps = getMowerCapabilities(input.device.model);
  }

  /** Rich, mower-specific capability record. */
  get mowerCapabilities(): MowerCapabilities {
    return this.#caps;
  }

  #num(siid: number, piid: number): number | null {
    return asNum(this.getProperty(siid, piid)?.value);
  }

  // -- typed state --------------------------------------------------------
  get statusRaw(): number | null {
    return this.#num(MOWER_PROP.STATUS.siid, MOWER_PROP.STATUS.piid);
  }
  get status(): MowerStatus | null {
    return STATUS(this.statusRaw);
  }
  get battery(): number | null {
    return this.#num(MOWER_PROP.BATTERY.siid, MOWER_PROP.BATTERY.piid);
  }
  get chargingRaw(): number | null {
    return this.#num(MOWER_PROP.CHARGING_STATUS.siid, MOWER_PROP.CHARGING_STATUS.piid);
  }
  get charging(): MowerChargingStatus | null {
    return CHARGING(this.chargingRaw);
  }
  /** Docked => on the dock (Charging / ChargingComplete state). */
  get isDocked(): boolean {
    const s = this.status;
    return s === MowerStatus.Charging || s === MowerStatus.ChargingComplete;
  }
  get isMowing(): boolean {
    return this.status === MowerStatus.Mowing;
  }
  get taskStatusRaw(): number | null {
    return this.#num(MOWER_PROP.TASK_STATUS.siid, MOWER_PROP.TASK_STATUS.piid);
  }
  /** Parsed scheduling task descriptor (2:50), or null. */
  get task(): MowerTaskDescriptor | null {
    return parseTaskDescriptor(
      this.getProperty(MOWER_PROP.SCHEDULING_TASK.siid, MOWER_PROP.SCHEDULING_TASK.piid)?.value,
    );
  }
  /**
   * Mowing coverage target / progress signal from the task descriptor (`d.o`).
   * This is the P4 progress surface; the byte-accurate pose-track % is P5.
   */
  get coverageTargetPct(): number | null {
    return this.task?.coverageTarget ?? null;
  }
  /** Parsed per-zone control status (2:56), or null. */
  get controlStatus(): MowerControlState | null {
    return parseControlStatus(
      this.getProperty(MOWER_PROP.MOWER_CONTROL_STATUS.siid, MOWER_PROP.MOWER_CONTROL_STATUS.piid)
        ?.value,
    );
  }
  get controlAction(): MowerControlAction | null {
    return this.controlStatus?.action ?? null;
  }

  /** Props worth seeding on start() / polling — exported for the facade. */
  static readonly DEFAULT_PROPS = [
    MOWER_PROP.STATUS,
    MOWER_PROP.BATTERY,
    MOWER_PROP.CHARGING_STATUS,
    MOWER_PROP.TASK_STATUS,
    MOWER_PROP.SCHEDULING_TASK,
    MOWER_PROP.MOWER_CONTROL_STATUS,
  ] as const;
}
