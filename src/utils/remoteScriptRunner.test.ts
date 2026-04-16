import { describe, it, expect, vi } from 'vitest';
import { executeScriptOnTarget } from './remoteScriptRunner';

describe('executeScriptOnTarget', () => {
  it('returns null error on successful script execution', () => {
    const result = executeScriptOnTarget('const x = 1 + 2', {});
    expect(result.error).toBeNull();
  });

  it('returns error string for syntax errors', () => {
    const result = executeScriptOnTarget('function(', {});
    expect(result.error).toBeTruthy();
  });

  it('returns error string for runtime errors', () => {
    const result = executeScriptOnTarget('throw new Error("boom")', {});
    expect(result.error).toBe('boom');
  });

  it('calls sshd() producing side effect on target', () => {
    const sshd = vi.fn(() => 'sshd is running on port 22');
    const result = executeScriptOnTarget('sshd()', { sshd });
    expect(result.error).toBeNull();
    expect(sshd).toHaveBeenCalled();
  });

  it('forwards arguments to commands in context', () => {
    const sshd = vi.fn(() => 'sshd is running on port 2222');
    const result = executeScriptOnTarget('sshd(2222)', { sshd });
    expect(result.error).toBeNull();
    expect(sshd).toHaveBeenCalledWith(2222);
  });

  it('provides full command context — all commands callable', () => {
    const cat = vi.fn(() => 'root:x:0:0:root:/root:/bin/bash');
    const ls = vi.fn(() => 'file1  file2');
    const rm = vi.fn();
    executeScriptOnTarget('cat("/etc/passwd"); ls("/tmp"); rm("/tmp/file1")', {
      cat,
      ls,
      rm,
    });
    expect(cat).toHaveBeenCalledWith('/etc/passwd');
    expect(ls).toHaveBeenCalledWith('/tmp');
    expect(rm).toHaveBeenCalledWith('/tmp/file1');
  });

  it('script can use return values from commands for logic', () => {
    const cat = vi.fn(() => 'root:x:0:0:root:/root:/bin/bash\nadmin:x:1000:1000::/home/admin');
    const sshd = vi.fn();
    executeScriptOnTarget(
      'const users = cat("/etc/passwd"); if (users.includes("root")) { sshd() }',
      { cat, sshd },
    );
    expect(sshd).toHaveBeenCalled();
  });

  it('does not provide _system() — only for mission verification', () => {
    const result = executeScriptOnTarget('_system("test")', {});
    expect(result.error).toBeTruthy();
  });

  it('does not provide echo() unless explicitly in context', () => {
    const result = executeScriptOnTarget('echo("test")', {});
    expect(result.error).toBeTruthy();
  });

  it('returns no output — execution is blind', () => {
    const result = executeScriptOnTarget('const x = 42', {});
    // Only error field exists — no output/lines field
    expect(Object.keys(result)).toEqual(['error']);
  });

  it('handles multi-statement scripts', () => {
    const nc = vi.fn();
    const sshd = vi.fn();
    const result = executeScriptOnTarget(
      ['const port = 4444', 'nc("-l", port)', 'sshd(22)'].join('\n'),
      { nc, sshd },
    );
    expect(result.error).toBeNull();
    expect(nc).toHaveBeenCalledWith('-l', 4444);
    expect(sshd).toHaveBeenCalledWith(22);
  });

  it('stops execution on command error and reports it', () => {
    const sshd = vi.fn(() => {
      throw new Error('sshd: permission denied: port 22 requires root');
    });
    const result = executeScriptOnTarget('sshd()', { sshd });
    expect(result.error).toBe('sshd: permission denied: port 22 requires root');
  });
});
