import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAutoComplete } from './useAutoComplete';

describe('useAutoComplete', () => {
  describe('empty input', () => {
    it('should return empty results for empty string', () => {
      const { result } = renderHook(() => useAutoComplete(['help', 'echo']));

      const completions = result.current.getCompletions('');

      expect(completions.matches).toEqual([]);
      expect(completions.displayText).toBe('');
      expect(completions.commonPrefix).toBe('');
    });

    it('should return empty results for whitespace only', () => {
      const { result } = renderHook(() => useAutoComplete(['help', 'echo']));

      const completions = result.current.getCompletions('   ');

      expect(completions.matches).toEqual([]);
      expect(completions.displayText).toBe('');
      expect(completions.commonPrefix).toBe('');
    });
  });

  describe('no matches', () => {
    it('should return empty results when no commands match', () => {
      const { result } = renderHook(() => useAutoComplete(['help', 'echo']));

      const completions = result.current.getCompletions('xyz');

      expect(completions.matches).toEqual([]);
      expect(completions.displayText).toBe('');
    });

    it('should return empty results when no variables match', () => {
      const { result } = renderHook(() => useAutoComplete([], ['foo', 'bar']));

      const completions = result.current.getCompletions('xyz');

      expect(completions.matches).toEqual([]);
      expect(completions.displayText).toBe('');
    });
  });

  describe('command matching', () => {
    it('should match single command', () => {
      const { result } = renderHook(() => useAutoComplete(['help', 'echo', 'clear']));

      const completions = result.current.getCompletions('hel');

      expect(completions.matches).toHaveLength(1);
      expect(completions.matches[0]).toEqual({ name: 'help', display: 'help' });
    });

    it('should match multiple commands', () => {
      const { result } = renderHook(() => useAutoComplete(['help', 'hello', 'history']));

      const completions = result.current.getCompletions('he');

      expect(completions.matches).toHaveLength(2);
      expect(completions.matches.map((m) => m.name)).toEqual(['hello', 'help']);
    });

    it('should use bare command name in display (no parens)', () => {
      const { result } = renderHook(() => useAutoComplete(['echo']));

      const completions = result.current.getCompletions('e');

      expect(completions.matches[0].display).toBe('echo');
    });

    it('should match exact command name', () => {
      const { result } = renderHook(() => useAutoComplete(['ls', 'lsof']));

      const completions = result.current.getCompletions('ls');

      expect(completions.matches).toHaveLength(2);
      expect(completions.matches.map((m) => m.name)).toContain('ls');
      expect(completions.matches.map((m) => m.name)).toContain('lsof');
    });
  });

  describe('variable matching', () => {
    it('should match single variable', () => {
      const { result } = renderHook(() => useAutoComplete([], ['count', 'total']));

      const completions = result.current.getCompletions('cou');

      expect(completions.matches).toHaveLength(1);
      expect(completions.matches[0]).toEqual({ name: 'count', display: 'count' });
    });

    it('should match multiple variables', () => {
      const { result } = renderHook(() => useAutoComplete([], ['name', 'namespace', 'number']));

      const completions = result.current.getCompletions('na');

      expect(completions.matches).toHaveLength(2);
      expect(completions.matches.map((m) => m.name)).toEqual(['name', 'namespace']);
    });

    it('should not add () suffix to variable display', () => {
      const { result } = renderHook(() => useAutoComplete([], ['myVar']));

      const completions = result.current.getCompletions('my');

      expect(completions.matches[0].display).toBe('myVar');
    });
  });

  describe('mixed commands and variables', () => {
    it('should match both commands and variables', () => {
      const { result } = renderHook(() => useAutoComplete(['help', 'hello'], ['helper', 'helm']));

      const completions = result.current.getCompletions('hel');

      expect(completions.matches).toHaveLength(4);
      expect(completions.matches.map((m) => m.name)).toEqual(['hello', 'helm', 'help', 'helper']);
    });

    it('should use bare names for both commands and variables in display', () => {
      const { result } = renderHook(() => useAutoComplete(['test'], ['testing']));

      const completions = result.current.getCompletions('test');

      const testCmd = completions.matches.find((m) => m.name === 'test');
      const testingVar = completions.matches.find((m) => m.name === 'testing');

      expect(testCmd?.display).toBe('test');
      expect(testingVar?.display).toBe('testing');
    });
  });

  describe('case insensitivity', () => {
    it('should match regardless of input case', () => {
      const { result } = renderHook(() => useAutoComplete(['Help', 'ECHO']));

      const completions = result.current.getCompletions('hel');

      expect(completions.matches).toHaveLength(1);
      expect(completions.matches[0].name).toBe('Help');
    });

    it('should match uppercase input to lowercase command', () => {
      const { result } = renderHook(() => useAutoComplete(['help']));

      const completions = result.current.getCompletions('HEL');

      expect(completions.matches).toHaveLength(1);
      expect(completions.matches[0].name).toBe('help');
    });

    it('should match mixed case input', () => {
      const { result } = renderHook(() => useAutoComplete(['helpMe']));

      const completions = result.current.getCompletions('HeLp');

      expect(completions.matches).toHaveLength(1);
      expect(completions.matches[0].name).toBe('helpMe');
    });
  });

  describe('sorting', () => {
    it('should sort matches alphabetically', () => {
      const { result } = renderHook(() => useAutoComplete(['zebra', 'alpha', 'beta']));

      const completions = result.current.getCompletions('a');

      expect(completions.matches.map((m) => m.name)).toEqual(['alpha']);
    });

    it('should sort mixed commands and variables alphabetically', () => {
      const { result } = renderHook(() => useAutoComplete(['cat', 'cd'], ['count', 'config']));

      const completions = result.current.getCompletions('c');

      expect(completions.matches.map((m) => m.name)).toEqual(['cat', 'cd', 'config', 'count']);
    });
  });

  describe('displayText', () => {
    it('should return comma-separated display text', () => {
      const { result } = renderHook(() => useAutoComplete(['help', 'history']));

      const completions = result.current.getCompletions('h');

      expect(completions.displayText).toBe('help, history');
    });

    it('should include both commands and variables in display text', () => {
      const { result } = renderHook(() => useAutoComplete(['echo'], ['error']));

      const completions = result.current.getCompletions('e');

      expect(completions.displayText).toBe('echo, error');
    });

    it('should return single item without comma', () => {
      const { result } = renderHook(() => useAutoComplete(['unique']));

      const completions = result.current.getCompletions('uni');

      expect(completions.displayText).toBe('unique');
    });
  });

  describe('commonPrefix', () => {
    it('should return full name as prefix for single match', () => {
      const { result } = renderHook(() => useAutoComplete(['help', 'echo']));

      const completions = result.current.getCompletions('hel');

      expect(completions.commonPrefix).toBe('help');
    });

    it('should return longest common prefix for multiple matches', () => {
      const { result } = renderHook(() => useAutoComplete(['reset', 'resolve', 'respond']));

      const completions = result.current.getCompletions('r');

      expect(completions.commonPrefix).toBe('res');
    });

    it('should return input-length prefix when matches diverge immediately', () => {
      const { result } = renderHook(() => useAutoComplete(['cat', 'cd', 'clear']));

      const completions = result.current.getCompletions('c');

      expect(completions.commonPrefix).toBe('c');
    });

    it('should return empty prefix for no matches', () => {
      const { result } = renderHook(() => useAutoComplete(['help']));

      const completions = result.current.getCompletions('xyz');

      expect(completions.commonPrefix).toBe('');
    });

    it('should compute prefix across commands and variables', () => {
      const { result } = renderHook(() => useAutoComplete(['strings'], ['stringify']));

      const completions = result.current.getCompletions('str');

      expect(completions.commonPrefix).toBe('string');
    });
  });

  describe('edge cases', () => {
    it('should handle empty command list', () => {
      const { result } = renderHook(() => useAutoComplete([]));

      const completions = result.current.getCompletions('test');

      expect(completions.matches).toEqual([]);
    });

    it('should handle single character input', () => {
      const { result } = renderHook(() => useAutoComplete(['a', 'ab', 'abc']));

      const completions = result.current.getCompletions('a');

      expect(completions.matches).toHaveLength(3);
    });

    it('should handle input with leading/trailing spaces', () => {
      const { result } = renderHook(() => useAutoComplete(['help']));

      const completions = result.current.getCompletions('  help  ');

      expect(completions.matches).toHaveLength(1);
      expect(completions.matches[0].name).toBe('help');
    });

    it('should not match partial middle of word', () => {
      const { result } = renderHook(() => useAutoComplete(['getHelp', 'helper']));

      const completions = result.current.getCompletions('Help');

      // Should only match 'helper' (starts with), not 'getHelp' (contains)
      expect(completions.matches).toHaveLength(1);
      expect(completions.matches[0].name).toBe('helper');
    });
  });
});
