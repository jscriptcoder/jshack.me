import { describe, expect, it } from 'vitest';
import { parsePipeline } from './pipeline.js';
import type { Token } from './tokenize.js';

const word = (value: string): Token => ({ kind: 'word', value });
const pipe: Token = { kind: 'pipe' };
const redirect: Token = { kind: 'redirect' };
const append: Token = { kind: 'append' };

describe('parsePipeline', () => {
  it('returns an empty pipeline for no tokens', () => {
    expect(parsePipeline([])).toEqual({ ok: true, pipeline: { stages: [] } });
  });

  it('builds a single stage from a bare command', () => {
    expect(parsePipeline([word('pwd')])).toEqual({
      ok: true,
      pipeline: { stages: [{ name: 'pwd', args: [] }] },
    });
  });

  it('splits the command name from its arguments', () => {
    expect(parsePipeline([word('cat'), word('-n'), word('notes.txt')])).toEqual({
      ok: true,
      pipeline: { stages: [{ name: 'cat', args: ['-n', 'notes.txt'] }] },
    });
  });

  it('splits two stages across a pipe', () => {
    const tokens = [word('cat'), word('/etc/passwd'), pipe, word('grep'), word('root')];
    expect(parsePipeline(tokens)).toEqual({
      ok: true,
      pipeline: {
        stages: [
          { name: 'cat', args: ['/etc/passwd'] },
          { name: 'grep', args: ['root'] },
        ],
      },
    });
  });

  it('splits three or more stages', () => {
    const tokens = [
      word('cat'),
      word('f'),
      pipe,
      word('grep'),
      word('x'),
      pipe,
      word('grep'),
      word('y'),
    ];
    expect(parsePipeline(tokens)).toEqual({
      ok: true,
      pipeline: {
        stages: [
          { name: 'cat', args: ['f'] },
          { name: 'grep', args: ['x'] },
          { name: 'grep', args: ['y'] },
        ],
      },
    });
  });

  it('rejects a leading pipe (empty first stage)', () => {
    expect(parsePipeline([pipe, word('cat')])).toEqual({
      ok: false,
      error: "syntax error near unexpected token `|'",
    });
  });

  it('rejects a trailing pipe (empty last stage)', () => {
    expect(parsePipeline([word('cat'), pipe])).toEqual({
      ok: false,
      error: "syntax error near unexpected token `|'",
    });
  });

  it('rejects consecutive pipes (empty middle stage)', () => {
    expect(parsePipeline([word('cat'), pipe, pipe, word('grep')])).toEqual({
      ok: false,
      error: "syntax error near unexpected token `|'",
    });
  });

  it('strips a trailing redirect and reports its target path', () => {
    expect(parsePipeline([word('echo'), word('hi'), redirect, word('f')])).toEqual({
      ok: true,
      pipeline: { stages: [{ name: 'echo', args: ['hi'] }], redirect: { path: 'f', append: false } },
    });
  });

  it('applies the redirect to the last stage of a pipeline', () => {
    const tokens = [word('cat'), word('x'), pipe, word('grep'), word('y'), redirect, word('out')];
    expect(parsePipeline(tokens)).toEqual({
      ok: true,
      pipeline: {
        stages: [
          { name: 'cat', args: ['x'] },
          { name: 'grep', args: ['y'] },
        ],
        redirect: { path: 'out', append: false },
      },
    });
  });

  it('rejects a leading redirect (no command before it)', () => {
    expect(parsePipeline([redirect, word('f')])).toEqual({
      ok: false,
      error: "syntax error near unexpected token `>'",
    });
  });

  it('rejects a redirect with no target (trailing redirect)', () => {
    expect(parsePipeline([word('echo'), redirect])).toEqual({
      ok: false,
      error: "syntax error near unexpected token `newline'",
    });
  });

  it('rejects a redirect whose target is another operator', () => {
    expect(parsePipeline([word('echo'), redirect, pipe, word('cat')])).toEqual({
      ok: false,
      error: "syntax error near unexpected token `|'",
    });
  });

  it('rejects extra tokens after the redirect target', () => {
    expect(parsePipeline([word('echo'), redirect, word('f'), word('g')])).toEqual({
      ok: false,
      error: "syntax error near unexpected token `g'",
    });
  });

  it('reports `>` when a second redirect immediately follows the first', () => {
    // `echo > > f` — the target slot holds another redirect operator.
    expect(parsePipeline([word('echo'), redirect, redirect, word('f')])).toEqual({
      ok: false,
      error: "syntax error near unexpected token `>'",
    });
  });

  it('rejects a redirect that is not on the final stage', () => {
    // `echo > f | cat` — the pipe after the target is the extra token.
    expect(parsePipeline([word('echo'), redirect, word('f'), pipe, word('cat')])).toEqual({
      ok: false,
      error: "syntax error near unexpected token `|'",
    });
  });

  it('strips a trailing append and marks the redirect as appending', () => {
    expect(parsePipeline([word('echo'), word('hi'), append, word('f')])).toEqual({
      ok: true,
      pipeline: { stages: [{ name: 'echo', args: ['hi'] }], redirect: { path: 'f', append: true } },
    });
  });

  it('applies the append to the last stage of a pipeline', () => {
    const tokens = [word('cat'), word('x'), pipe, word('grep'), word('y'), append, word('out')];
    expect(parsePipeline(tokens)).toEqual({
      ok: true,
      pipeline: {
        stages: [
          { name: 'cat', args: ['x'] },
          { name: 'grep', args: ['y'] },
        ],
        redirect: { path: 'out', append: true },
      },
    });
  });

  it('rejects a leading append, naming `>>`', () => {
    expect(parsePipeline([append, word('f')])).toEqual({
      ok: false,
      error: "syntax error near unexpected token `>>'",
    });
  });

  it('rejects an append with no target', () => {
    expect(parsePipeline([word('echo'), append])).toEqual({
      ok: false,
      error: "syntax error near unexpected token `newline'",
    });
  });

  it('rejects extra tokens after the append target', () => {
    expect(parsePipeline([word('echo'), append, word('f'), word('g')])).toEqual({
      ok: false,
      error: "syntax error near unexpected token `g'",
    });
  });

  it('reports `>` for `>>>`, whose append target is a redirect', () => {
    expect(parsePipeline([word('echo'), append, redirect, word('f')])).toEqual({
      ok: false,
      error: "syntax error near unexpected token `>'",
    });
  });

  it('reports `>>` when an append follows a redirect', () => {
    expect(parsePipeline([word('echo'), redirect, append, word('f')])).toEqual({
      ok: false,
      error: "syntax error near unexpected token `>>'",
    });
  });
});
