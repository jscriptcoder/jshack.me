import { describe, expect, it } from 'vitest';
import { formatCommandList, help } from './help';
import type { Command, TerminalLine } from './types';
import { mockCommandEnv } from '../../test/factories/commandEnv';

const NO_FLAGS = new Map<string, string | true>();

/** Minimal Command fixture — the formatter only reads name/description/
 *  category/manual, so `execute` is a no-op stub. */
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

describe('formatCommandList', () => {
  it('groups commands under their category label, General before Filesystem', () => {
    const contents = contentsOf(
      formatCommandList([
        buildCommand({ name: 'ls', category: 'filesystem' }),
        buildCommand({ name: 'echo', category: 'general' }),
      ]),
    );

    const generalHeader = contents.indexOf(' General');
    const filesystemHeader = contents.indexOf(' Filesystem');
    const echoRow = contents.findIndex((line) => line.includes('echo'));
    const lsRow = contents.findIndex((line) => line.includes('ls'));

    expect(generalHeader).toBeGreaterThanOrEqual(0);
    expect(filesystemHeader).toBeGreaterThan(generalHeader);
    // echo sits under General; ls sits under Filesystem
    expect(echoRow).toBeGreaterThan(generalHeader);
    expect(echoRow).toBeLessThan(filesystemHeader);
    expect(lsRow).toBeGreaterThan(filesystemHeader);
  });

  it('omits headers for categories that have no commands', () => {
    const contents = contentsOf(
      formatCommandList([buildCommand({ name: 'echo', category: 'general' })]),
    );

    expect(contents).toContain(' General');
    expect(contents).not.toContain(' Filesystem');
    expect(contents).not.toContain(' Mission');
    expect(contents).not.toContain(' Network');
    expect(contents).not.toContain(' WiFi');
  });

  it('sorts commands alphabetically within a section', () => {
    const contents = contentsOf(
      formatCommandList([
        buildCommand({ name: 'zebra', category: 'general' }),
        buildCommand({ name: 'alpha', category: 'general' }),
      ]),
    );

    const alphaRow = contents.findIndex((line) => line.includes('alpha'));
    const zebraRow = contents.findIndex((line) => line.includes('zebra'));

    expect(alphaRow).toBeGreaterThanOrEqual(0);
    expect(alphaRow).toBeLessThan(zebraRow);
  });

  it('shows the manual synopsis, falls back to the name, and aligns descriptions to a shared width', () => {
    const contents = contentsOf(
      formatCommandList([
        buildCommand({
          name: 'a',
          category: 'general',
          manual: { synopsis: 'a [long-synopsis]', description: 'ignored' },
        }),
        buildCommand({ name: 'bb', category: 'general' }), // no manual → name is the synopsis
      ]),
    );

    const rowWithSynopsis = contents.find((line) => line.includes('long-synopsis'));
    const rowWithFallback = contents.find((line) => line.includes('desc for bb'));

    expect(rowWithSynopsis).toBeDefined();
    expect(rowWithFallback).toBeDefined();
    if (rowWithSynopsis === undefined || rowWithFallback === undefined) return;

    // fallback: the manual-less command shows its name as the synopsis
    expect(rowWithFallback.trimStart().startsWith('bb')).toBe(true);
    // shared padding width: both rows' descriptions start at the same column,
    // and it is wide enough to clear the longest synopsis ('a [long-synopsis]')
    expect(rowWithSynopsis.indexOf('desc for a')).toBe(rowWithFallback.indexOf('desc for bb'));
    expect(rowWithFallback.indexOf('desc for bb')).toBeGreaterThan('a [long-synopsis]'.length);
  });

  it('renders the exact section layout a player sees (one populated category)', () => {
    // Golden layout contract: leading blank, header, an underline rule (dim)
    // spanning the synopsis column plus the gutter, the padded command row,
    // a trailing blank, and the dim footer. Pins the line `kind`s, the blank
    // lines, the rule width, and proves empty categories contribute NOTHING
    // (no stray lines from the other four categories' empty branch).
    const lines = formatCommandList([buildCommand({ name: 'echo', category: 'general' })]);

    expect(lines).toEqual([
      { kind: 'text', content: '' },
      { kind: 'text', content: ' General' },
      { kind: 'dim', content: ` ${'─'.repeat(48)}` }, // synopsis width 4 ('echo') + 44 gutter
      { kind: 'text', content: '   echo  desc for echo' },
      { kind: 'text', content: '' },
      { kind: 'dim', content: ' Use man <command> for detailed help.' },
    ]);
  });

  it('ends with the man hint footer', () => {
    const lines = formatCommandList([buildCommand({ name: 'echo', category: 'general' })]);
    const last = lines[lines.length - 1];

    expect(last.content).toBe(' Use man <command> for detailed help.');
  });
});

describe('help', () => {
  it('returns the live registry as a sectioned sync listing, exit 0, including itself', async () => {
    const result = await help.execute(mockCommandEnv(), [], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);

    const contents = contentsOf(result.lines);
    expect(contents).toContain(' General');
    expect(contents).toContain(' Filesystem');
    // help lists itself (general) and a filesystem command
    expect(contents.some((line) => line.includes('help'))).toBe(true);
    expect(contents.some((line) => line.includes('ls'))).toBe(true);
  });
});
