import { describe, it, expect } from 'vitest';
import { ncHelpCommand } from './help';

describe('ncHelpCommand', () => {
  it('lists only recon commands — no bash', () => {
    const output = ncHelpCommand.fn() as string;
    expect(output).toContain('pwd');
    expect(output).toContain('cd');
    expect(output).toContain('ls');
    expect(output).toContain('cat');
    expect(output).toContain('whoami');
    expect(output).toContain('exit');
    expect(output).not.toContain('bash');
  });
});
