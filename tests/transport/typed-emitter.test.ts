import { describe, it, expect, vi } from 'vitest';
import { TypedEmitter } from '../../src/transport/typed-emitter.js';

type Events = { ping: [number]; done: [] };

describe('TypedEmitter', () => {
  it('emits typed payloads to on/off listeners', () => {
    const em = new TypedEmitter<Events>();
    const fn = vi.fn();
    em.on('ping', fn);
    em.emit('ping', 7);
    expect(fn).toHaveBeenCalledWith(7);
    em.off('ping', fn);
    em.emit('ping', 8);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('once fires exactly once', () => {
    const em = new TypedEmitter<Events>();
    const fn = vi.fn();
    em.once('done', fn);
    em.emit('done');
    em.emit('done');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('removeAllListeners detaches every listener and is chainable', () => {
    const em = new TypedEmitter<Events>();
    const ping = vi.fn();
    const done = vi.fn();
    em.on('ping', ping);
    em.on('done', done);
    const returned = em.removeAllListeners();
    expect(returned).toBe(em);
    em.emit('ping', 1);
    em.emit('done');
    expect(ping).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
  });
});
