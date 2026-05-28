import { describe, expect, it } from 'vitest';
import { bindFlags, type FlagSpec } from './bindFlags';

/** Slice 1: boolean flags + strict unknown-flag errors. String flags arrive
 *  in Slice 2, stacking in Slice 4, the `--` sentinel in Slice 5. */

describe('bindFlags', () => {
  it('returns empty positional and flags for no args and empty spec', () => {
    expect(bindFlags([], {})).toEqual({
      ok: true,
      positional: [],
      flags: new Map(),
    });
  });

  it('treats every non-dash arg as positional when the spec is empty', () => {
    expect(bindFlags(['/etc/passwd', 'notes.txt'], {})).toEqual({
      ok: true,
      positional: ['/etc/passwd', 'notes.txt'],
      flags: new Map(),
    });
  });

  it('recognises a boolean flag declared in the spec', () => {
    const spec: FlagSpec = { '-n': 'boolean' };
    expect(bindFlags(['-n', '/etc/passwd'], spec)).toEqual({
      ok: true,
      positional: ['/etc/passwd'],
      flags: new Map([['-n', true]]),
    });
  });

  it('accepts a boolean flag positioned after a positional argument', () => {
    const spec: FlagSpec = { '-n': 'boolean' };
    expect(bindFlags(['/etc/passwd', '-n'], spec)).toEqual({
      ok: true,
      positional: ['/etc/passwd'],
      flags: new Map([['-n', true]]),
    });
  });

  it('preserves the order of positional arguments around a flag', () => {
    const spec: FlagSpec = { '-n': 'boolean' };
    expect(bindFlags(['a', '-n', 'b', 'c'], spec)).toEqual({
      ok: true,
      positional: ['a', 'b', 'c'],
      flags: new Map([['-n', true]]),
    });
  });

  it('sets multiple distinct boolean flags', () => {
    const spec: FlagSpec = { '-n': 'boolean', '-E': 'boolean' };
    expect(bindFlags(['-n', '-E', 'file'], spec)).toEqual({
      ok: true,
      positional: ['file'],
      flags: new Map([
        ['-n', true],
        ['-E', true],
      ]),
    });
  });

  it('rejects an unknown flag with a message naming the offending token', () => {
    const spec: FlagSpec = { '-n': 'boolean' };
    expect(bindFlags(['-xyz', 'file'], spec)).toEqual({
      ok: false,
      error: 'unrecognized option: -xyz',
    });
  });

  it('rejects any dash-prefixed token when the spec is empty', () => {
    expect(bindFlags(['-n', 'file'], {})).toEqual({
      ok: false,
      error: 'unrecognized option: -n',
    });
  });

  it('treats a bare dash as a positional argument', () => {
    // POSIX convention: `-` alone means "stdin"; it's a positional, never a
    // flag, regardless of what the spec contains.
    expect(bindFlags(['-', 'file'], {})).toEqual({
      ok: true,
      positional: ['-', 'file'],
      flags: new Map(),
    });
  });

  it('stops at the first unknown flag without parsing the rest', () => {
    // Strict-error guarantee: we don't silently accept later valid flags
    // after rejecting an earlier unknown one.
    const spec: FlagSpec = { '-n': 'boolean' };
    expect(bindFlags(['-xyz', '-n', 'file'], spec)).toEqual({
      ok: false,
      error: 'unrecognized option: -xyz',
    });
  });
});
