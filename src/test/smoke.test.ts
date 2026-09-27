import { describe, expect, it } from 'vitest';
import { createSignal } from 'solid-js';

describe('toolchain smoke', () => {
  it('solid signals work', () => {
    const [value, setValue] = createSignal(0);
    expect(value()).toBe(0);
    setValue(7);
    expect(value()).toBe(7);
  });

  it('typescript compiles strict code', () => {
    const tuple: readonly [number, string] = [1, 'a'];
    expect(tuple).toEqual([1, 'a']);
  });
});
