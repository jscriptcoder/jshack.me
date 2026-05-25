import { useCallback, useRef } from 'react';

// Returns a callback whose identity stays stable across renders while
// always dispatching to the LATEST `fn` passed in. Lets consumers
// capture the returned reference (e.g. inside a closure that escapes
// the render tree via an event-driven AsyncOutput dispatch) without
// the closure-capture-of-stale-state bug class. Same mechanism as
// React 19.2's `useEffectEvent`, but without the "call only from
// effects" lint restriction — fine for event-driven dispatch paths.
export const useStableCallback = <T extends (...args: never[]) => unknown>(fn: T): T => {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback(((...args: Parameters<T>) => ref.current(...args)) as T, []);
};
