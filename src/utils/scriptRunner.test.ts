import { describe, it, expect } from 'vitest';
import { runScriptWithSystem, type ScriptRunnerResult } from './scriptRunner';

// Helper to assert sync result (not a Promise)
const expectSync = (
  result: ScriptRunnerResult | Promise<ScriptRunnerResult>,
): ScriptRunnerResult => {
  expect(result).not.toBeInstanceOf(Promise);
  return result as ScriptRunnerResult;
};

describe('runScriptWithSystem', () => {
  it('captures value passed to _system', () => {
    const result = expectSync(runScriptWithSystem('_system("hello")'));
    expect(result.systemValue).toBe('hello');
    expect(result.error).toBeNull();
  });

  it('returns null systemValue when _system is never called', () => {
    const result = expectSync(runScriptWithSystem('const x = 1 + 2'));
    expect(result.systemValue).toBeNull();
    expect(result.error).toBeNull();
  });

  it('captures the last _system call value', () => {
    const result = expectSync(runScriptWithSystem('_system("first"); _system("second")'));
    expect(result.systemValue).toBe('second');
  });

  it('returns error for syntax errors', () => {
    const result = expectSync(runScriptWithSystem('function('));
    expect(result.systemValue).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('returns error for runtime errors', () => {
    const result = expectSync(runScriptWithSystem('throw new Error("boom")'));
    expect(result.systemValue).toBeNull();
    expect(result.error).toBe('boom');
  });

  it('provides no-op echo that does not throw', () => {
    const result = expectSync(runScriptWithSystem('echo("info"); _system("ok")'));
    expect(result.systemValue).toBe('ok');
    expect(result.error).toBeNull();
  });

  it('converts non-string values to string', () => {
    const result = expectSync(runScriptWithSystem('_system(42)'));
    expect(result.systemValue).toBe('42');
  });

  it('works with typical script_fix script pattern', () => {
    const script = [
      'const backups = ["db_full", "db_diff", "logs", "config"]',
      'const critical = backups.filter(b => b.startsWith("db"))',
      'if (critical.length === 2) {',
      '  _system(critical.join("-"))',
      '} else {',
      '  echo("ERROR: backup validation failed")',
      '}',
    ].join('\n');
    const result = expectSync(runScriptWithSystem(script));
    expect(result.systemValue).toBe('db_full-db_diff');
    expect(result.error).toBeNull();
  });

  it('does not capture _system when error branch is taken', () => {
    const script = [
      'const data = [1, 2]',
      'if (data.length === 5) {',
      '  _system("ok")',
      '} else {',
      '  echo("ERROR: check failed")',
      '}',
    ].join('\n');
    const result = expectSync(runScriptWithSystem(script));
    expect(result.systemValue).toBeNull();
    expect(result.error).toBeNull();
  });

  it('accepts extra context functions', () => {
    const script = 'const data = JSON.parse(cat("/data.json")); _system(data.key)';
    const result = expectSync(
      runScriptWithSystem(script, {
        cat: () => '{"key":"found-it"}',
      }),
    );
    expect(result.systemValue).toBe('found-it');
    expect(result.error).toBeNull();
  });

  it('extra context overrides default echo', () => {
    const lines: string[] = [];
    const result = expectSync(
      runScriptWithSystem('echo("tracked"); _system("ok")', {
        echo: (...args: readonly unknown[]) => {
          lines.push(String(args[0]));
          return '';
        },
      }),
    );
    expect(result.systemValue).toBe('ok');
    expect(lines).toEqual(['tracked']);
  });

  it('handles async scripts with await', async () => {
    const script = 'const val = await fetchData(); _system(val)';
    const result = runScriptWithSystem(script, {
      fetchData: () => 'async-value',
    });
    expect(result).toBeInstanceOf(Promise);
    const resolved = await result;
    expect(resolved.systemValue).toBe('async-value');
    expect(resolved.error).toBeNull();
  });

  it('sync script error prevents returning captured value', () => {
    const script = '_system("captured"); throw new Error("after")';
    const result = expectSync(runScriptWithSystem(script));
    expect(result.error).toBe('after');
  });
});
