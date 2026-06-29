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
  | 'dust-bag';

/** One consumable's wire coordinates: remaining-life property + optional reset action. */
export interface ConsumableSpec {
  readonly key: DreameConsumableKey;
  readonly label: string;
  /** Remaining-life % property (0..100). */
  readonly life: { readonly siid: number; readonly piid: number };
  /** "Mark replaced / reset life" action, or null when the model exposes none. */
  readonly reset: { readonly siid: number; readonly aiid: number } | null;
}

/**
 * Every consumable nodedreame knows. The reset action shares the consumable's
 * service `siid` with `aiid 1` (Tasshack action map). `dust-bag` has a life
 * property but no reset action.
 */
export const VACUUM_CONSUMABLES: readonly ConsumableSpec[] = [
  { key: 'main-brush', label: 'Main Brush', life: { siid: 9, piid: 2 }, reset: { siid: 9, aiid: 1 } },
  { key: 'side-brush', label: 'Side Brush', life: { siid: 10, piid: 2 }, reset: { siid: 10, aiid: 1 } },
  { key: 'filter', label: 'Filter', life: { siid: 11, piid: 1 }, reset: { siid: 11, aiid: 1 } },
  { key: 'sensor', label: 'Sensor', life: { siid: 16, piid: 1 }, reset: { siid: 16, aiid: 1 } },
  { key: 'tank-filter', label: 'Tank Filter', life: { siid: 17, piid: 1 }, reset: { siid: 17, aiid: 1 } },
  { key: 'mop-pad', label: 'Mop Pad', life: { siid: 18, piid: 1 }, reset: { siid: 18, aiid: 1 } },
  { key: 'silver-ion', label: 'Silver-ion', life: { siid: 19, piid: 2 }, reset: { siid: 19, aiid: 1 } },
  { key: 'detergent', label: 'Detergent', life: { siid: 20, piid: 1 }, reset: { siid: 20, aiid: 1 } },
  { key: 'squeegee', label: 'Squeegee', life: { siid: 24, piid: 1 }, reset: { siid: 24, aiid: 1 } },
  { key: 'dust-bag', label: 'Dust Bag', life: { siid: 27, piid: 17 }, reset: null },
] as const;

/** Lookup a consumable spec by key (undefined for an unknown key). */
export function consumableSpec(key: DreameConsumableKey): ConsumableSpec | undefined {
  return VACUUM_CONSUMABLES.find((c) => c.key === key);
}

/** A resolved consumable reading: which consumable, its remaining life %, and
 *  whether a reset action exists. Only the consumables the model REPORTS appear. */
export interface ConsumableReading {
  readonly key: DreameConsumableKey;
  readonly label: string;
  readonly leftPct: number;
  readonly resettable: boolean;
}
