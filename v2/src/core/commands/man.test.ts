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
          synopsis: 'foo <target> [bar]',
          description: 'Foo frobnicates the bar.',
          arguments: [
            { name: 'target', description: 'What to frobnicate', required: true },
            { name: 'bar', description: 'The bar to use' },
          ],
          examples: [
            { command: 'foo /etc', description: 'Frobnicate /etc' },
            { command: 'foo /etc --bar', description: 'Frobnicate /etc with the bar' },
          ],
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
      { kind: 'text', content: '    foo <target> [bar]' },
      { kind: 'text', content: '' },
      { kind: 'text', content: 'DESCRIPTION' },
      { kind: 'text', content: '    Foo frobnicates the bar.' },
      { kind: 'text', content: '' },
      // ARGUMENTS: each arg is name + (required|optional) marker, then its
      // description indented one level deeper. No blank between args; one blank
      // closes the whole section.
      { kind: 'text', content: 'ARGUMENTS' },
      { kind: 'text', content: '    target (required)' },
      { kind: 'text', content: '        What to frobnicate' },
      { kind: 'text', content: '    bar (optional)' },
      { kind: 'text', content: '        The bar to use' },
      { kind: 'text', content: '' },
      // EXAMPLES: each example is the command, then its description indented one
      // level deeper, then a trailing blank line — per example (legacy parity).
      { kind: 'text', content: 'EXAMPLES' },
      { kind: 'text', content: '    foo /etc' },
      { kind: 'text', content: '        Frobnicate /etc' },
      { kind: 'text', content: '' },
      { kind: 'text', content: '    foo /etc --bar' },
      { kind: 'text', content: '        Frobnicate /etc with the bar' },
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

  it('omits ARGUMENTS and EXAMPLES for a synopsis/description-only manual', () => {
    const lines = formatManPage(
      buildCommand({
        name: 'foo',
        category: 'general',
        manual: { synopsis: 'foo', description: 'A foo.' },
      }),
    );

    // Exact layout proves SYNOPSIS/DESCRIPTION render but neither the ARGUMENTS
    // nor the EXAMPLES branch contributes any stray lines when both are absent.
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

  it('omits the ARGUMENTS header for an explicitly empty arguments array', () => {
    const contents = contentsOf(
      formatManPage(
        buildCommand({
          name: 'foo',
          category: 'general',
          manual: { synopsis: 'foo', description: 'A foo.', arguments: [] },
        }),
      ),
    );

    expect(contents).toContain('DESCRIPTION');
    expect(contents).not.toContain('ARGUMENTS');
  });

  it('omits the EXAMPLES header for an explicitly empty examples array', () => {
    const contents = contentsOf(
      formatManPage(
        buildCommand({
          name: 'foo',
          category: 'general',
          manual: { synopsis: 'foo', description: 'A foo.', examples: [] },
        }),
      ),
    );

    expect(contents).toContain('DESCRIPTION');
    expect(contents).not.toContain('EXAMPLES');
  });

  it('renders an ARGUMENTS section even when there are no examples', () => {
    const contents = contentsOf(
      formatManPage(
        buildCommand({
          name: 'foo',
          category: 'general',
          manual: {
            synopsis: 'foo <x>',
            description: 'A foo.',
            arguments: [{ name: 'x', description: 'the x', required: true }],
          },
        }),
      ),
    );

    expect(contents).toContain('ARGUMENTS');
    expect(contents).toContain('    x (required)');
    expect(contents).toContain('        the x');
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
    // The richer manual: an ARGUMENTS section listing ls's flags/positional...
    expect(contents).toContain('ARGUMENTS');
    expect(contents).toContain('    -a (optional)');
    expect(contents).toContain('    -l (optional)');
    expect(contents).toContain('    path (optional)');
    // ...and at least one example rendered with its description beneath it.
    expect(contents).toContain('    ls -la sub');
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
