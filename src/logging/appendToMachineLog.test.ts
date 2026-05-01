import { describe, expect, it, vi } from 'vitest';

import { appendToMachineLog } from './appendToMachineLog';

const makeFs = (existingContent: string | null = null) => {
  const readFileFromMachine = vi.fn().mockReturnValue(existingContent);
  const writeFileToMachine = vi.fn().mockReturnValue({ allowed: true });
  const createFileOnMachine = vi.fn().mockReturnValue({ allowed: true });
  return { readFileFromMachine, writeFileToMachine, createFileOnMachine };
};

describe('appendToMachineLog', () => {
  it('appends a line to an existing log file', () => {
    const fs = makeFs('existing line 1\nexisting line 2');
    appendToMachineLog('192.168.1.10', '/var/log/auth.log', 'new log entry', fs);

    expect(fs.readFileFromMachine).toHaveBeenCalledWith({
      machineId: '192.168.1.10',
      path: '/var/log/auth.log',
      cwd: '/',
      userType: 'root',
    });
    expect(fs.writeFileToMachine).toHaveBeenCalledWith({
      machineId: '192.168.1.10',
      path: '/var/log/auth.log',
      cwd: '/',
      content: 'existing line 1\nexisting line 2\nnew log entry',
      userType: 'root',
    });
    expect(fs.createFileOnMachine).not.toHaveBeenCalled();
  });

  it('creates the log file when it does not exist', () => {
    const fs = makeFs(null);
    appendToMachineLog('10.0.0.5', '/var/log/vsftpd.log', 'first entry', fs);

    expect(fs.readFileFromMachine).toHaveBeenCalledWith({
      machineId: '10.0.0.5',
      path: '/var/log/vsftpd.log',
      cwd: '/',
      userType: 'root',
    });
    expect(fs.createFileOnMachine).toHaveBeenCalledWith({
      machineId: '10.0.0.5',
      path: '/var/log/vsftpd.log',
      cwd: '/',
      content: 'first entry',
      userType: 'root',
      permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] },
    });
    expect(fs.writeFileToMachine).not.toHaveBeenCalled();
  });

  it('appends to a file with trailing newline without adding extra blank line', () => {
    const fs = makeFs('existing content\n');
    appendToMachineLog('192.168.1.10', '/var/log/auth.log', 'new entry', fs);

    expect(fs.writeFileToMachine).toHaveBeenCalledWith({
      machineId: '192.168.1.10',
      path: '/var/log/auth.log',
      cwd: '/',
      content: 'existing content\nnew entry',
      userType: 'root',
    });
  });

  it('handles empty string content by creating fresh', () => {
    const fs = makeFs('');
    appendToMachineLog('192.168.1.10', '/var/log/auth.log', 'first entry', fs);

    expect(fs.writeFileToMachine).toHaveBeenCalledWith({
      machineId: '192.168.1.10',
      path: '/var/log/auth.log',
      cwd: '/',
      content: 'first entry',
      userType: 'root',
    });
  });

  describe('multi-line burst (string[] form)', () => {
    it('joins an array of lines with \\n and writes once to an existing file', () => {
      const fs = makeFs('previous line');
      appendToMachineLog(
        '192.168.1.10',
        '/var/log/auth.log',
        ['brute force attempt', 'Accepted password for alice', 'Accepted password for bob'],
        fs,
      );

      expect(fs.writeFileToMachine).toHaveBeenCalledTimes(1);
      expect(fs.createFileOnMachine).not.toHaveBeenCalled();
      expect(fs.writeFileToMachine).toHaveBeenCalledWith({
        machineId: '192.168.1.10',
        path: '/var/log/auth.log',
        cwd: '/',
        content:
          'previous line\nbrute force attempt\nAccepted password for alice\nAccepted password for bob',
        userType: 'root',
      });
    });

    it('creates the file with all joined lines when missing', () => {
      const fs = makeFs(null);
      appendToMachineLog(
        '10.0.0.5',
        '/var/log/auth.log',
        ['line one', 'line two', 'line three'],
        fs,
      );

      expect(fs.createFileOnMachine).toHaveBeenCalledTimes(1);
      expect(fs.writeFileToMachine).not.toHaveBeenCalled();
      expect(fs.createFileOnMachine).toHaveBeenCalledWith({
        machineId: '10.0.0.5',
        path: '/var/log/auth.log',
        cwd: '/',
        content: 'line one\nline two\nline three',
        userType: 'root',
        permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] },
      });
    });

    it('writes a single-element array exactly like a string', () => {
      const fs = makeFs('existing');
      appendToMachineLog('192.168.1.10', '/var/log/auth.log', ['just one'], fs);

      expect(fs.writeFileToMachine).toHaveBeenCalledWith({
        machineId: '192.168.1.10',
        path: '/var/log/auth.log',
        cwd: '/',
        content: 'existing\njust one',
        userType: 'root',
      });
    });

    it('is a no-op when the array is empty', () => {
      const fs = makeFs('existing');
      appendToMachineLog('192.168.1.10', '/var/log/auth.log', [], fs);

      expect(fs.readFileFromMachine).not.toHaveBeenCalled();
      expect(fs.writeFileToMachine).not.toHaveBeenCalled();
      expect(fs.createFileOnMachine).not.toHaveBeenCalled();
    });

    it('all lines survive even when the underlying writeFileToMachine would race on two separate calls', () => {
      // Regression: if hydra split aggregate + per-success into two appendToMachineLog
      // calls, both would read the same pre-batch React state and the second write
      // would overwrite the first. The array form forces a single read-modify-write
      // so all lines persist. This test pins the contract that the array form
      // produces ONE write and the joined content contains every line.
      const fs = makeFs('startup line');
      appendToMachineLog(
        '192.168.1.10',
        '/var/log/auth.log',
        ['aggregate brute-force', 'Accepted password for alice', 'Accepted password for bob'],
        fs,
      );

      expect(fs.writeFileToMachine).toHaveBeenCalledTimes(1);
      const writtenContent = fs.writeFileToMachine.mock.calls[0]![0].content as string;
      expect(writtenContent).toContain('aggregate brute-force');
      expect(writtenContent).toContain('Accepted password for alice');
      expect(writtenContent).toContain('Accepted password for bob');
    });
  });
});
