import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStableCallback } from './useStableCallback';

describe('useStableCallback', () => {
  it('returns a callback with stable identity across renders', () => {
    const initialFn: () => string = () => 'first';
    const { result, rerender } = renderHook(({ fn }) => useStableCallback(fn), {
      initialProps: { fn: initialFn },
    });

    const firstReference = result.current;
    rerender({ fn: () => 'second' });
    const secondReference = result.current;

    expect(secondReference).toBe(firstReference);
  });

  it('invokes the latest implementation passed to the hook', () => {
    const firstImpl = vi.fn(() => 'first');
    const secondImpl = vi.fn(() => 'second');

    const { result, rerender } = renderHook(({ fn }) => useStableCallback(fn), {
      initialProps: { fn: firstImpl as () => string },
    });

    expect(result.current()).toBe('first');

    rerender({ fn: secondImpl as () => string });

    expect(result.current()).toBe('second');
    expect(firstImpl).toHaveBeenCalledTimes(1);
    expect(secondImpl).toHaveBeenCalledTimes(1);
  });

  it('lets a captured-then-stale closure still invoke the latest impl', () => {
    // Simulates the closure-capture pattern: a consumer captures the
    // callback reference at render N, then invokes it after render
    // N+1 has updated the impl. The captured reference must dispatch
    // to the LATEST impl, not the one available at capture time.
    const firstImpl = vi.fn(() => 'first');
    const secondImpl = vi.fn(() => 'second');

    const { result, rerender } = renderHook(({ fn }) => useStableCallback(fn), {
      initialProps: { fn: firstImpl as () => string },
    });

    const capturedAtRenderOne = result.current;

    rerender({ fn: secondImpl as () => string });

    expect(capturedAtRenderOne()).toBe('second');
    expect(firstImpl).not.toHaveBeenCalled();
    expect(secondImpl).toHaveBeenCalledTimes(1);
  });

  it('forwards arguments to the latest implementation', () => {
    const impl = vi.fn((a: number, b: number) => a + b);

    const { result } = renderHook(({ fn }) => useStableCallback(fn), {
      initialProps: { fn: impl as (a: number, b: number) => number },
    });

    expect(result.current(2, 3)).toBe(5);
    expect(impl).toHaveBeenCalledWith(2, 3);
  });
});
