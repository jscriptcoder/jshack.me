import { describe, expect, it } from 'vitest';
import { commandEchoLine, formatPrompt } from './prompt';

const alice = { username: 'alice', host: 'workstation' } as const;

describe('formatPrompt', () => {
  it('renders the prompt as user@host>', () => {
    expect(formatPrompt(alice)).toBe('alice@workstation>');
  });
});

describe('commandEchoLine', () => {
  it('echoes the command after the prompt as a prompt-kind line', () => {
    expect(commandEchoLine(alice, 'cat /etc/passwd')).toEqual({
      kind: 'prompt',
      content: 'alice@workstation> cat /etc/passwd',
    });
  });

  it('echoes a bare prompt when the command is empty', () => {
    expect(commandEchoLine(alice, '')).toEqual({
      kind: 'prompt',
      content: 'alice@workstation> ',
    });
  });
});
