import { describe, it, expect } from 'vitest';
import { LIBRARY_NAME } from '../src/index.js';

describe('library metadata', () => {
  it('exposes the library name', () => {
    expect(LIBRARY_NAME).toBe('nodedreame');
  });
});
