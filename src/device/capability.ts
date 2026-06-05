/**
 * A read-only set of capability tokens a device model supports. Phase 2 ships
 * only the shape + a no-op default; P3/P4 populate per-model tables behind the
 * same {@link CapabilityResolver} interface.
 */
export interface DeviceCapabilities {
  readonly model: string;
  /** Whether the model is known to support a capability token. */
  has(token: string): boolean;
  /** All known capability tokens for the model. */
  list(): readonly string[];
}

/** Resolves the capability set for a device model string. */
export interface CapabilityResolver {
  resolve(model: string): DeviceCapabilities;
}

/** Immutable capability set backed by a token set. */
class CapabilitySet implements DeviceCapabilities {
  readonly model: string;
  readonly #tokens: ReadonlySet<string>;

  constructor(model: string, tokens: ReadonlySet<string>) {
    this.model = model;
    this.#tokens = tokens;
  }

  has(token: string): boolean {
    return this.#tokens.has(token);
  }

  list(): readonly string[] {
    return [...this.#tokens];
  }
}

/**
 * Default resolver: every model resolves to an EMPTY capability set. This is a
 * deliberate no-op scaffold — device-family resolvers (vacuum/mower) override
 * `resolve` in later phases while keeping this interface stable.
 */
export class DefaultCapabilityResolver implements CapabilityResolver {
  resolve(model: string): DeviceCapabilities {
    return new CapabilitySet(model, new Set<string>());
  }
}

const sharedDefault = new DefaultCapabilityResolver();

/** Convenience: resolve capabilities via the shared default resolver. */
export function resolveCapabilities(model: string): DeviceCapabilities {
  return sharedDefault.resolve(model);
}
