import { describe, it, expect } from 'vitest';
import { defaultFetch } from '../../src/transport/fetch.js';

describe('defaultFetch', () => {
  it('is a callable fetch-shaped function from undici', () => {
    expect(typeof defaultFetch).toBe('function');
  });
});
