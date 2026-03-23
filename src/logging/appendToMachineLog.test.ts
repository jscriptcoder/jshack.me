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
});
