import { describe, expect, it } from 'vitest';
import { parsePipeline } from './pipeline';
import type { Token } from './tokenize';

const word = (value: string): Token => ({ kind: 'word', value });
const pipe: Token = { kind: 'pipe' };

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
});
