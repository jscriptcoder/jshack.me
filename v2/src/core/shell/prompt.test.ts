import { describe, expect, it } from 'vitest';
import { commandEchoLine, formatPrompt } from './prompt';

const aliceAtHome = { username: 'alice', host: 'workstation', cwd: '/home/alice' } as const;

describe('formatPrompt', () => {
  it('renders the prompt as user@host:cwd$ (bash-style)', () => {
    expect(formatPrompt(aliceAtHome)).toBe('alice@workstation:/home/alice$');
  });

  it('renders cwd `/` (filesystem root) without doubling slashes', () => {
    // Catches StringLiteral mutators that drop the cwd or insert a stray `/`.
    expect(formatPrompt({ username: 'alice', host: 'workstation', cwd: '/' })).toBe(
      'alice@workstation:/$',
    );
  });

  it('reflects a deep cwd verbatim', () => {
    expect(
      formatPrompt({ username: 'alice', host: 'workstation', cwd: '/tmp/sub/deeper' }),
    ).toBe('alice@workstation:/tmp/sub/deeper$');
  });

  it('uses the username and host verbatim (catches swapped field mutants)', () => {
    expect(formatPrompt({ username: 'root', host: 'gateway', cwd: '/' })).toBe(
      'root@gateway:/$',
    );
  });
});

describe('commandEchoLine', () => {
  it('echoes the command after the prompt as a prompt-kind line', () => {
    expect(commandEchoLine(aliceAtHome, 'cat /etc/passwd')).toEqual({
      kind: 'prompt',
      content: 'alice@workstation:/home/alice$ cat /etc/passwd',
    });
  });

  it('echoes a bare prompt when the command is empty', () => {
    expect(commandEchoLine(aliceAtHome, '')).toEqual({
      kind: 'prompt',
      content: 'alice@workstation:/home/alice$ ',
    });
  });

  it('reflects a different cwd in the echoed line', () => {
    expect(
      commandEchoLine({ username: 'alice', host: 'workstation', cwd: '/tmp' }, 'pwd'),
    ).toEqual({
      kind: 'prompt',
      content: 'alice@workstation:/tmp$ pwd',
    });
  });
});
