import { describe, expect, it } from 'vitest';
import { formatManPage, man } from './man';
import type { Command, TerminalLine } from './types';
import { mockCommandEnv } from '../../test/factories/commandEnv';

const NO_FLAGS = new Map<string, string | true>();

/** Minimal Command fixture — formatManPage only reads name/description/manual. */
const buildCommand = (
  overrides: Partial<Command> & Pick<Command, 'name' | 'category'>,
): Command => ({
  description: `desc for ${overrides.name}`,
  tier: 'guest',
  availability: { kind: 'any-machine' },
  execute: async () => ({ kind: 'sync', lines: [], exitCode: 0 }),
  ...overrides,
});

const contentsOf = (lines: readonly TerminalLine[]): readonly string[] =>
  lines.map((line) => line.content);

describe('formatManPage', () => {
  it('renders the exact manual page layout for a command with a full manual', () => {
    const lines = formatManPage(
      buildCommand({
        name: 'foo',
        category: 'general',
        description: 'Do the foo thing',
        manual: {
          synopsis: 'foo [bar]',
          description: 'Foo frobnicates the bar.',
          examples: ['foo', 'foo --bar'],
        },
      }),
    );

    expect(lines).toEqual([
      { kind: 'text', content: 'FOO(1)' },
      { kind: 'text', content: '' },
      { kind: 'text', content: 'NAME' },
      { kind: 'text', content: '    foo - Do the foo thing' },
      { kind: 'text', content: '' },
      { kind: 'text', content: 'SYNOPSIS' },
      { kind: 'text', content: '    foo [bar]' },
      { kind: 'text', content: '' },
      { kind: 'text', content: 'DESCRIPTION' },
      { kind: 'text', content: '    Foo frobnicates the bar.' },
      { kind: 'text', content: '' },
      { kind: 'text', content: 'EXAMPLES' },
      { kind: 'text', content: '    foo' },
      { kind: 'text', content: '    foo --bar' },
      { kind: 'text', content: '' },
    ]);
  });

  it('renders only the header, NAME, and a fallback line when the command has no manual', () => {
    const lines = formatManPage(buildCommand({ name: 'bare', category: 'general' }));

    expect(lines).toEqual([
      { kind: 'text', content: 'BARE(1)' },
      { kind: 'text', content: '' },
      { kind: 'text', content: 'NAME' },
      { kind: 'text', content: '    bare - desc for bare' },
      { kind: 'text', content: '' },
      { kind: 'text', content: 'No detailed manual available for this command.' },
      { kind: 'text', content: '' },
    ]);
  });

  it('omits the EXAMPLES section when the manual has no examples', () => {
    const lines = formatManPage(
      buildCommand({
        name: 'foo',
        category: 'general',
        manual: { synopsis: 'foo', description: 'A foo.' },
      }),
    );

    // Exact layout proves SYNOPSIS/DESCRIPTION render but the EXAMPLES branch
    // contributes nothing (no stray lines) when there are no examples.
    expect(lines).toEqual([
      { kind: 'text', content: 'FOO(1)' },
      { kind: 'text', content: '' },
      { kind: 'text', content: 'NAME' },
      { kind: 'text', content: '    foo - desc for foo' },
      { kind: 'text', content: '' },
      { kind: 'text', content: 'SYNOPSIS' },
      { kind: 'text', content: '    foo' },
      { kind: 'text', content: '' },
      { kind: 'text', content: 'DESCRIPTION' },
      { kind: 'text', content: '    A foo.' },
      { kind: 'text', content: '' },
    ]);
  });

  it('also omits EXAMPLES for an explicitly empty examples array', () => {
    const contents = contentsOf(
      formatManPage(
        buildCommand({
          name: 'foo',
          category: 'general',
          manual: { synopsis: 'foo', description: 'A foo.', examples: [] },
        }),
      ),
    );

    expect(contents).toContain('SYNOPSIS');
    expect(contents).not.toContain('EXAMPLES');
  });
});

describe('man', () => {
  it('renders the manual page for a registered command (man ls)', async () => {
    const result = await man.execute(mockCommandEnv(), ['ls'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);

    const contents = contentsOf(result.lines);
    expect(contents).toContain('LS(1)');
    expect(contents).toContain('    ls - List directory contents');
    expect(contents).toContain('SYNOPSIS');
    expect(contents).toContain('    ls [-a] [-l] [path]');
  });

  it('errors with a usage message and exit 2 when no command name is given', async () => {
    const result = await man.execute(mockCommandEnv(), [], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(2);

    // Both lines are error-kind (rendered as errors, not normal output).
    expect(result.lines).toEqual([
      { kind: 'error', content: 'man: missing command name' },
      { kind: 'error', content: 'Usage: man <command>' },
    ]);
  });

  it('errors with exit 1 when there is no manual entry for the command', async () => {
    const result = await man.execute(mockCommandEnv(), ['nonesuch'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);

    expect(result.lines).toEqual([
      { kind: 'error', content: "man: no manual entry for 'nonesuch'" },
    ]);
  });

  it('can render its own manual page (man man)', async () => {
    const result = await man.execute(mockCommandEnv(), ['man'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(contentsOf(result.lines)).toContain('MAN(1)');
  });
});
