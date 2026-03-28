import { describe, it, expect } from 'vitest';
import { runScriptWithSystem } from './scriptRunner';

describe('runScriptWithSystem', () => {
  it('captures value passed to _system', () => {
    const result = runScriptWithSystem('_system("hello")');
    expect(result.systemValue).toBe('hello');
    expect(result.error).toBeNull();
  });

  it('returns null systemValue when _system is never called', () => {
    const result = runScriptWithSystem('const x = 1 + 2');
    expect(result.systemValue).toBeNull();
    expect(result.error).toBeNull();
  });

  it('captures the last _system call value', () => {
    const result = runScriptWithSystem('_system("first"); _system("second")');
    expect(result.systemValue).toBe('second');
  });

  it('returns error for syntax errors', () => {
    const result = runScriptWithSystem('function(');
    expect(result.systemValue).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('returns error for runtime errors', () => {
    const result = runScriptWithSystem('throw new Error("boom")');
    expect(result.systemValue).toBeNull();
    expect(result.error).toBe('boom');
  });

  it('provides no-op echo that does not throw', () => {
    const result = runScriptWithSystem('echo("info"); _system("ok")');
    expect(result.systemValue).toBe('ok');
    expect(result.error).toBeNull();
  });

  it('converts non-string values to string', () => {
    const result = runScriptWithSystem('_system(42)');
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
    const result = runScriptWithSystem(script);
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
    const result = runScriptWithSystem(script);
    expect(result.systemValue).toBeNull();
    expect(result.error).toBeNull();
  });
});
