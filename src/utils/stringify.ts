const isPromise = (value: unknown): value is Promise<unknown> =>
  value !== null &&
  typeof value === 'object' &&
  'then' in value &&
  typeof (value as Promise<unknown>).then === 'function';

/**
 * Convert any value to a string representation.
 * Objects and arrays are pretty-printed as JSON.
 * Promises are displayed as [Promise] to hint users need to await them in a script.
 */
export const stringify = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (isPromise(value)) return '[Promise] - await it inside a node script';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
};
