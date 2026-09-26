/**
 * Vacuum consumable/maintenance map (ported from Tasshack `dreame-vacuum`
 * v2.0.0b25 — property + action mappings). Each consumable lives on its own MIoT
 * service `siid`: a remaining-life `%` property (`siid/piid`) and a "reset to
 * 100%" action (`siid/aiid 1`). A model exposes only a SUBSET — which is
 * discovered by PRESENCE (the device reports the life property) rather than a
 * hardcoded per-model list, mirroring how the HA integration derives support.
 */

/** Stable consumable keys (kebab-case so a consumer can use them verbatim). */
export type DreameConsumableKey =
  | 'main-brush'
  | 'side-brush'
  | 'filter'
  | 'sensor'
  | 'tank-filter'
  | 'mop-pad'
  | 'silver-ion'
  | 'detergent'
  | 'squeegee'
  | 'deodorizer'
  | 'wheel'
  | 'scale-inhibitor'
  | 'dust-bag';

/** The unit a consumable's time-left property counts in. */
export type ConsumableTimeLeftUnit = 'hours' | 'days';

/** A consumable's time-left property: where it lives and what it counts in. */
export interface ConsumableTimeLeftSpec {
  readonly siid: number;
  readonly piid: number;
  readonly unit: ConsumableTimeLeftUnit;
}

/** A consumable's time left as the robot reports it. */
export interface ConsumableTimeLeft {
  readonly value: number;
  readonly unit: ConsumableTimeLeftUnit;
}

/** One consumable's wire coordinates: remaining-life property + optional reset action. */
export interface ConsumableSpec {
  readonly key: DreameConsumableKey;
  readonly label: string;
  /** Remaining-life % property (0..100). */
  readonly life: { readonly siid: number; readonly piid: number };
  /**
   * The time-left twin on the same service (the other piid), or null when the
   * consumable has none. A reset rewrites it together with {@link life}.
   */
  readonly timeLeft: ConsumableTimeLeftSpec | null;
  /** "Mark replaced / reset life" action, or null when the model exposes none. */
  readonly reset: { readonly siid: number; readonly aiid: number } | null;
}

/**
 * Every consumable nodedreame knows. The reset action shares the consumable's
 * service `siid` with `aiid 1` (Tasshack action map). `dust-bag` has a life
 * property but no reset action and no time-left twin.
 *
 * Time-left twins: the service's other piid. Measured against the Dreame app on
 * an r2538z on 2026-09-26 ("Tempo residuo"): main brush 9/1 = 271 h at 90 %,
 * side brush 10/1 = 171 h at 85 %, filter 11/2 = 121 h at 80 %, sensors 16/2 =
 * 1 h at 4 % — each consistent with its life (300/200/150/30 h). Wheel 30/1 and
 * scale inhibitor 31/1 count DAYS (HA units for that robot). The rest are the
 * mapping the camstack Dreame addon already shipped; not measured on a robot
 * that reports them.
 *
 * Labels `Sensor Dirty` / `Wheel Dirty` are the maintenance the app and HA name
 * (clean the sensors / wheels) — a bare "Sensor at 4 %" read as a broken part.
 */
export const VACUUM_CONSUMABLES: readonly ConsumableSpec[] = [
  {
    key: 'main-brush',
    label: 'Main Brush',
    life: { siid: 9, piid: 2 },
    timeLeft: { siid: 9, piid: 1, unit: 'hours' },
    reset: { siid: 9, aiid: 1 },
  },
  {
    key: 'side-brush',
    label: 'Side Brush',
    life: { siid: 10, piid: 2 },
    timeLeft: { siid: 10, piid: 1, unit: 'hours' },
    reset: { siid: 10, aiid: 1 },
  },
  {
    key: 'filter',
    label: 'Filter',
    life: { siid: 11, piid: 1 },
    timeLeft: { siid: 11, piid: 2, unit: 'hours' },
    reset: { siid: 11, aiid: 1 },
  },
  {
    key: 'sensor',
    label: 'Sensor Dirty',
    life: { siid: 16, piid: 1 },
    timeLeft: { siid: 16, piid: 2, unit: 'hours' },
    reset: { siid: 16, aiid: 1 },
  },
  {
    key: 'tank-filter',
    label: 'Tank Filter',
    life: { siid: 17, piid: 1 },
    timeLeft: { siid: 17, piid: 2, unit: 'hours' },
    reset: { siid: 17, aiid: 1 },
  },
  {
    key: 'mop-pad',
    label: 'Mop Pad',
    life: { siid: 18, piid: 1 },
    timeLeft: { siid: 18, piid: 2, unit: 'hours' },
    reset: { siid: 18, aiid: 1 },
  },
  {
    key: 'silver-ion',
    label: 'Silver-ion',
    life: { siid: 19, piid: 2 },
    timeLeft: { siid: 19, piid: 1, unit: 'days' },
    reset: { siid: 19, aiid: 1 },
  },
  {
    key: 'detergent',
    label: 'Detergent',
    life: { siid: 20, piid: 1 },
    timeLeft: { siid: 20, piid: 2, unit: 'days' },
    reset: { siid: 20, aiid: 1 },
  },
  {
    key: 'squeegee',
    label: 'Squeegee',
    life: { siid: 24, piid: 1 },
    timeLeft: { siid: 24, piid: 2, unit: 'days' },
    reset: { siid: 24, aiid: 1 },
  },
  {
    key: 'deodorizer',
    label: 'Deodorizer',
    life: { siid: 29, piid: 2 },
    timeLeft: { siid: 29, piid: 1, unit: 'days' },
    reset: { siid: 29, aiid: 1 },
  },
  {
    key: 'wheel',
    label: 'Wheel Dirty',
    life: { siid: 30, piid: 2 },
    timeLeft: { siid: 30, piid: 1, unit: 'days' },
    reset: { siid: 30, aiid: 1 },
  },
  {
    key: 'scale-inhibitor',
    label: 'Scale Inhibitor',
    life: { siid: 31, piid: 2 },
    timeLeft: { siid: 31, piid: 1, unit: 'days' },
    reset: { siid: 31, aiid: 1 },
  },
  {
    key: 'dust-bag',
    label: 'Dust Bag',
    life: { siid: 27, piid: 17 },
    timeLeft: null,
    reset: null,
  },
] as const;

/** Lookup a consumable spec by key (undefined for an unknown key). */
export function consumableSpec(key: DreameConsumableKey): ConsumableSpec | undefined {
  return VACUUM_CONSUMABLES.find((c) => c.key === key);
}

/** Narrow an arbitrary string to a known {@link DreameConsumableKey} — lets a
 *  string-keyed consumer (e.g. a generic consumables cap) validate before
 *  calling the typed reset path with no cast. */
export function isDreameConsumableKey(key: string): key is DreameConsumableKey {
  return VACUUM_CONSUMABLES.some((c) => c.key === key);
}

/** A resolved consumable reading: which consumable, its remaining life %, and
 *  whether a reset action exists. Only the consumables the model REPORTS appear. */
export interface ConsumableReading {
  readonly key: DreameConsumableKey;
  readonly label: string;
  readonly leftPct: number;
  readonly resettable: boolean;
}

/** Where a post-reset re-read came from: the robot itself, or the cloud shadow. */
export type ConsumableRefreshSource = 'device' | 'cloud-shadow';

/**
 * The outcome of a consumable reset. The action has SUCCEEDED whenever this
 * resolves; `refreshedFrom` says whether the values after it were re-read.
 * `null` there means both reads failed — `leftPct`/`timeLeft` are then `null`
 * (unknown, not zero) and the cache still holds the pre-reset values.
 * `refreshError` is why the better source was not used: the live read's error
 * when the shadow answered, the shadow's when neither did, else `null`.
 */
export interface ConsumableResetResult {
  readonly key: DreameConsumableKey;
  readonly actionResult: unknown;
  readonly refreshedFrom: ConsumableRefreshSource | null;
  readonly leftPct: number | null;
  readonly timeLeft: ConsumableTimeLeft | null;
  readonly refreshError: Error | null;
}
