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

    expect(fs.readFileFromMachine).toHaveBeenCalledWith(
      '192.168.1.10',
      '/var/log/auth.log',
      '/',
      'root',
    );
    expect(fs.writeFileToMachine).toHaveBeenCalledWith(
      '192.168.1.10',
      '/var/log/auth.log',
      '/',
      'existing line 1\nexisting line 2\nnew log entry',
      'root',
    );
    expect(fs.createFileOnMachine).not.toHaveBeenCalled();
  });

  it('creates the log file when it does not exist', () => {
    const fs = makeFs(null);
    appendToMachineLog('10.0.0.5', '/var/log/vsftpd.log', 'first entry', fs);

    expect(fs.readFileFromMachine).toHaveBeenCalledWith(
      '10.0.0.5',
      '/var/log/vsftpd.log',
      '/',
      'root',
    );
    expect(fs.createFileOnMachine).toHaveBeenCalledWith(
      '10.0.0.5',
      '/var/log/vsftpd.log',
      '/',
      'first entry',
      'root',
      { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] },
    );
    expect(fs.writeFileToMachine).not.toHaveBeenCalled();
  });

  it('appends to a file with trailing newline without adding extra blank line', () => {
    const fs = makeFs('existing content\n');
    appendToMachineLog('192.168.1.10', '/var/log/auth.log', 'new entry', fs);

    expect(fs.writeFileToMachine).toHaveBeenCalledWith(
      '192.168.1.10',
      '/var/log/auth.log',
      '/',
      'existing content\nnew entry',
      'root',
    );
  });

  it('handles empty string content by creating fresh', () => {
    const fs = makeFs('');
    appendToMachineLog('192.168.1.10', '/var/log/auth.log', 'first entry', fs);

    expect(fs.writeFileToMachine).toHaveBeenCalledWith(
      '192.168.1.10',
      '/var/log/auth.log',
      '/',
      'first entry',
      'root',
    );
  });
});
