import { describe, it, expect } from 'vitest';
import { stringify } from './stringify';

describe('stringify', () => {
  describe('primitive values', () => {
    it('should return "undefined" for undefined', () => {
      expect(stringify(undefined)).toBe('undefined');
    });

    it('should return "null" for null', () => {
      expect(stringify(null)).toBe('null');
    });

    it('should return string as-is', () => {
      expect(stringify('Hello World')).toBe('Hello World');
    });

    it('should return empty string as-is', () => {
      expect(stringify('')).toBe('');
    });

    it('should convert number to string', () => {
      expect(stringify(42)).toBe('42');
      expect(stringify(3.14)).toBe('3.14');
      expect(stringify(-100)).toBe('-100');
    });

    it('should convert boolean to string', () => {
      expect(stringify(true)).toBe('true');
      expect(stringify(false)).toBe('false');
    });
  });

  describe('promises', () => {
    it('should return descriptive string for Promise', () => {
      const promise = Promise.resolve('value');

      expect(stringify(promise)).toBe('[Promise] - await it inside a node script');
    });

    it('should detect rejected Promise', () => {
      const promise = Promise.reject('error');
      promise.catch(() => {}); // Prevent unhandled rejection

      expect(stringify(promise)).toBe('[Promise] - await it inside a node script');
    });
  });

  describe('objects and arrays', () => {
    it('should pretty-print object as JSON', () => {
      const result = stringify({ name: 'test', value: 123 });

      expect(result).toBe('{\n  "name": "test",\n  "value": 123\n}');
    });

    it('should pretty-print array as JSON', () => {
      const result = stringify([1, 2, 3]);

      expect(result).toBe('[\n  1,\n  2,\n  3\n]');
    });

    it('should pretty-print nested objects', () => {
      const result = stringify({ outer: { inner: 'value' } });

      expect(result).toContain('"outer"');
      expect(result).toContain('"inner"');
      expect(result).toContain('"value"');
    });

    it('should handle empty object', () => {
      expect(stringify({})).toBe('{}');
    });

    it('should handle empty array', () => {
      expect(stringify([])).toBe('[]');
    });

    it('should fall back to String() for circular references', () => {
      const circular: Record<string, unknown> = { name: 'test' };
      circular.self = circular;

      const result = stringify(circular);

      expect(result).toBe('[object Object]');
    });
  });
});
