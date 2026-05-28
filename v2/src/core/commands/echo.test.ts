import { describe, expect, it } from 'vitest';
import { echo } from './echo';
import { mockCommandEnv } from '../../test/factories/commandEnv';
import type { TerminalLine } from './types';

const NO_FLAGS = new Map<string, string | true>();

const textLines = (result: { readonly lines: readonly TerminalLine[] }): string[] =>
  result.lines.filter((line) => line.kind === 'text').map((line) => line.content);

describe('echo', () => {
  it('joins multiple positional arguments with a single space', async () => {
    const result = await echo.execute(mockCommandEnv(), ['a', 'b', 'c'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['a b c']);
  });

  it('emits the single positional unchanged when given exactly one', async () => {
    // The tokeniser delivers quoted spaces as one positional, so `echo
    // "hello world"` arrives here as ['hello world'].
    const result = await echo.execute(mockCommandEnv(), ['hello world'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['hello world']);
  });

  it('emits one empty line when called with no positional', async () => {
    const result = await echo.execute(mockCommandEnv(), [], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['']);
  });

  it('emits one empty line when called with a single empty positional', async () => {
    // The tokeniser yields `''` from `echo ""`. Both `echo` and `echo ""`
    // render the same blank line, but echo's input differs.
    const result = await echo.execute(mockCommandEnv(), [''], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['']);
  });

  it('preserves empty positionals when joining, yielding adjacent spaces', async () => {
    // `echo "a" "" "b"` → ['a', '', 'b'] → `a  b` (two spaces).
    const result = await echo.execute(mockCommandEnv(), ['a', '', 'b'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['a  b']);
  });
});
