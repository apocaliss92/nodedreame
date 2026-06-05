import { EventEmitter } from 'node:events';

/** A strongly-typed wrapper over Node's EventEmitter. */
export class TypedEmitter<Events extends Record<string, unknown[]>> {
  readonly #emitter = new EventEmitter();

  on<K extends keyof Events & string>(event: K, listener: (...args: Events[K]) => void): this {
    this.#emitter.on(event, listener as (...args: unknown[]) => void);
    return this;
  }

  once<K extends keyof Events & string>(event: K, listener: (...args: Events[K]) => void): this {
    this.#emitter.once(event, listener as (...args: unknown[]) => void);
    return this;
  }

  off<K extends keyof Events & string>(event: K, listener: (...args: Events[K]) => void): this {
    this.#emitter.off(event, listener as (...args: unknown[]) => void);
    return this;
  }

  emit<K extends keyof Events & string>(event: K, ...args: Events[K]): boolean {
    return this.#emitter.emit(event, ...args);
  }

  removeAllListeners(): this {
    this.#emitter.removeAllListeners();
    return this;
  }
}
