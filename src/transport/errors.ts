export class DreameError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DreameError';
  }
}

export class DreameAuthError extends DreameError {
  constructor(
    message: string,
    public readonly status?: number,
    cause?: unknown,
  ) {
    super(message, cause);
    this.name = 'DreameAuthError';
  }
}

export class DreameApiError extends DreameError {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
    cause?: unknown,
  ) {
    super(message, cause);
    this.name = 'DreameApiError';
  }
}

/**
 * Thrown when the cloud returns code 80001. The literal `msg` claims the
 * device is offline — that interpretation is FREQUENTLY WRONG. 80001 means
 * the cloud's HTTP-side waiter for the device's MQTT ACK gave up after ~8s.
 * It does NOT prove the action failed to reach the device. The MQTT
 * subscription is the source of truth for reachability. The only true
 * positive is a genuinely unreachable device (powered off / network lost /
 * rebooting) — in which case no MQTT echo arrives either.
 */
export class DreameDeviceOfflineError extends DreameApiError {
  constructor(message: string, status: number, body?: unknown) {
    super(message, status, body);
    this.name = 'DreameDeviceOfflineError';
  }
}

export class DreameTransportError extends DreameError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'DreameTransportError';
  }
}
