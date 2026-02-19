import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVariables, type VariableResult } from './useVariables';

describe('useVariables', () => {
  describe('const declaration', () => {
    it('should declare a const variable', () => {
      const { result } = renderHook(() => useVariables());

      let varResult;
      act(() => {
        varResult = result.current.handleVariableOperation('const x = 42', {});
      });

      expect(varResult).toEqual({ success: true, value: 42 });
      expect(result.current.getVariables()).toEqual({ x: 42 });
    });

    it('should evaluate expressions in const declaration', () => {
      const { result } = renderHook(() => useVariables());

      let varResult;
      act(() => {
        varResult = result.current.handleVariableOperation('const sum = 1 + 2 + 3', {});
      });

      expect(varResult).toEqual({ success: true, value: 6 });
    });

    it('should use execution context in const declaration', () => {
      const { result } = renderHook(() => useVariables());

      let varResult;
      act(() => {
        varResult = result.current.handleVariableOperation('const doubled = x * 2', { x: 10 });
      });

      expect(varResult).toEqual({ success: true, value: 20 });
    });

    it('should reference other variables in const declaration', () => {
      const { result } = renderHook(() => useVariables());

      act(() => {
        result.current.handleVariableOperation('const a = 5', {});
      });

      let varResult;
      act(() => {
        varResult = result.current.handleVariableOperation('const b = a + 10', {});
      });

      expect(varResult).toEqual({ success: true, value: 15 });
    });

    it('should reject redeclaration of const', () => {
      const { result } = renderHook(() => useVariables());

      act(() => {
        result.current.handleVariableOperation('const x = 1', {});
      });

      let varResult;
      act(() => {
        varResult = result.current.handleVariableOperation('const x = 2', {});
      });

      expect(varResult).toEqual({
        success: false,
        error: "Identifier 'x' has already been declared",
      });
    });

    it('should reject reassignment of const', () => {
      const { result } = renderHook(() => useVariables());

      act(() => {
        result.current.handleVariableOperation('const x = 1', {});
      });

      let varResult;
      act(() => {
        varResult = result.current.handleVariableOperation('x = 2', {});
      });

      expect(varResult).toEqual({
        success: false,
        error: "Assignment to constant variable 'x'",
      });
    });
  });

  describe('let declaration', () => {
    it('should declare a let variable', () => {
      const { result } = renderHook(() => useVariables());

      let varResult;
      act(() => {
        varResult = result.current.handleVariableOperation('let count = 0', {});
      });

      expect(varResult).toEqual({ success: true, value: 0 });
      expect(result.current.getVariables()).toEqual({ count: 0 });
    });

    it('should evaluate expressions in let declaration', () => {
      const { result } = renderHook(() => useVariables());

      let varResult;
      act(() => {
        varResult = result.current.handleVariableOperation('let result = Math.max(1, 5, 3)', {});
      });

      expect(varResult).toEqual({ success: true, value: 5 });
    });

    it('should reject redeclaration of let', () => {
      const { result } = renderHook(() => useVariables());

      act(() => {
        result.current.handleVariableOperation('let x = 1', {});
      });

      let varResult;
      act(() => {
        varResult = result.current.handleVariableOperation('let x = 2', {});
      });

      expect(varResult).toEqual({
        success: false,
        error: "Identifier 'x' has already been declared",
      });
    });

    it('should reject redeclaring let as const', () => {
      const { result } = renderHook(() => useVariables());

      act(() => {
        result.current.handleVariableOperation('let x = 1', {});
      });

      let varResult;
      act(() => {
        varResult = result.current.handleVariableOperation('const x = 2', {});
      });

      expect(varResult).toEqual({
        success: false,
        error: "Identifier 'x' has already been declared",
      });
    });
  });

  describe('reassignment', () => {
    it('should reassign let variable', () => {
      const { result } = renderHook(() => useVariables());

      act(() => {
        result.current.handleVariableOperation('let counter = 0', {});
      });

      let varResult;
      act(() => {
        varResult = result.current.handleVariableOperation('counter = 10', {});
      });

      expect(varResult).toEqual({ success: true, value: 10 });
      expect(result.current.getVariables()).toEqual({ counter: 10 });
    });

    it('should reassign using expressions', () => {
      const { result } = renderHook(() => useVariables());

      act(() => {
        result.current.handleVariableOperation('let x = 5', {});
      });

      let varResult;
      act(() => {
        varResult = result.current.handleVariableOperation('x = x + 1', {});
      });

      expect(varResult).toEqual({ success: true, value: 6 });
    });

    it('should return null for unknown variable assignment', () => {
      const { result } = renderHook(() => useVariables());

      let varResult;
      act(() => {
        varResult = result.current.handleVariableOperation('unknown = 42', {});
      });

      expect(varResult).toBeNull();
    });
  });

  describe('getVariables', () => {
    it('should return empty object initially', () => {
      const { result } = renderHook(() => useVariables());

      expect(result.current.getVariables()).toEqual({});
    });

    it('should return all declared variables', () => {
      const { result } = renderHook(() => useVariables());

      act(() => {
        result.current.handleVariableOperation('const a = 1', {});
        result.current.handleVariableOperation('let b = 2', {});
        result.current.handleVariableOperation('const c = 3', {});
      });

      expect(result.current.getVariables()).toEqual({ a: 1, b: 2, c: 3 });
    });
  });

  describe('getVariableNames', () => {
    it('should return empty array initially', () => {
      const { result } = renderHook(() => useVariables());

      expect(result.current.getVariableNames()).toEqual([]);
    });

    it('should return all variable names', () => {
      const { result } = renderHook(() => useVariables());

      act(() => {
        result.current.handleVariableOperation('const foo = 1', {});
        result.current.handleVariableOperation('let bar = 2', {});
      });

      expect(result.current.getVariableNames()).toContain('foo');
      expect(result.current.getVariableNames()).toContain('bar');
    });
  });

  describe('non-variable operations', () => {
    it('should return null for plain expressions', () => {
      const { result } = renderHook(() => useVariables());

      let varResult;
      act(() => {
        varResult = result.current.handleVariableOperation('1 + 2', {});
      });

      expect(varResult).toBeNull();
    });

    it('should return null for function calls', () => {
      const { result } = renderHook(() => useVariables());

      let varResult;
      act(() => {
        varResult = result.current.handleVariableOperation('console.log("test")', {});
      });

      expect(varResult).toBeNull();
    });

    it('should return null for empty string', () => {
      const { result } = renderHook(() => useVariables());

      let varResult;
      act(() => {
        varResult = result.current.handleVariableOperation('', {});
      });

      expect(varResult).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should return error for invalid expression in const', () => {
      const { result } = renderHook(() => useVariables());

      let varResult: VariableResult | null;
      act(() => {
        varResult = result.current.handleVariableOperation('const x = undefined_var', {});
      });

      expect(varResult!.success).toBe(false);
      expect(varResult!.error).toBeDefined();
    });

    it('should return error for invalid expression in let', () => {
      const { result } = renderHook(() => useVariables());

      let varResult: VariableResult | null;
      act(() => {
        varResult = result.current.handleVariableOperation('let x = syntax error here', {});
      });

      expect(varResult!.success).toBe(false);
      expect(varResult!.error).toBeDefined();
    });

    it('should return error for invalid expression in reassignment', () => {
      const { result } = renderHook(() => useVariables());

      act(() => {
        result.current.handleVariableOperation('let x = 1', {});
      });

      let varResult: VariableResult | null;
      act(() => {
        varResult = result.current.handleVariableOperation('x = undefined_var', {});
      });

      expect(varResult!.success).toBe(false);
      expect(varResult!.error).toBeDefined();
    });
  });

  describe('variable name patterns', () => {
    it('should accept names starting with underscore', () => {
      const { result } = renderHook(() => useVariables());

      let varResult;
      act(() => {
        varResult = result.current.handleVariableOperation('const _private = 42', {});
      });

      expect(varResult).toEqual({ success: true, value: 42 });
    });

    it('should accept names starting with dollar sign', () => {
      const { result } = renderHook(() => useVariables());

      let varResult;
      act(() => {
        varResult = result.current.handleVariableOperation('const $jquery = "loaded"', {});
      });

      expect(varResult).toEqual({ success: true, value: 'loaded' });
    });

    it('should accept names with numbers', () => {
      const { result } = renderHook(() => useVariables());

      let varResult;
      act(() => {
        varResult = result.current.handleVariableOperation('const item1 = "first"', {});
      });

      expect(varResult).toEqual({ success: true, value: 'first' });
    });

    it('should accept camelCase names', () => {
      const { result } = renderHook(() => useVariables());

      let varResult;
      act(() => {
        varResult = result.current.handleVariableOperation('const myVariable = true', {});
      });

      expect(varResult).toEqual({ success: true, value: true });
    });
  });

  describe('value types', () => {
    it('should handle string values', () => {
      const { result } = renderHook(() => useVariables());

      let varResult;
      act(() => {
        varResult = result.current.handleVariableOperation('const name = "hello"', {});
      });

      expect(varResult).toEqual({ success: true, value: 'hello' });
    });

    it('should handle boolean values', () => {
      const { result } = renderHook(() => useVariables());

      let varResult;
      act(() => {
        varResult = result.current.handleVariableOperation('const flag = true', {});
      });

      expect(varResult).toEqual({ success: true, value: true });
    });

    it('should handle null values', () => {
      const { result } = renderHook(() => useVariables());

      let varResult;
      act(() => {
        varResult = result.current.handleVariableOperation('const empty = null', {});
      });

      expect(varResult).toEqual({ success: true, value: null });
    });

    it('should handle array values', () => {
      const { result } = renderHook(() => useVariables());

      let varResult;
      act(() => {
        varResult = result.current.handleVariableOperation('const arr = [1, 2, 3]', {});
      });

      expect(varResult).toEqual({ success: true, value: [1, 2, 3] });
    });

    it('should handle object values', () => {
      const { result } = renderHook(() => useVariables());

      let varResult;
      act(() => {
        varResult = result.current.handleVariableOperation('const obj = { a: 1, b: 2 }', {});
      });

      expect(varResult).toEqual({ success: true, value: { a: 1, b: 2 } });
    });
  });
});
