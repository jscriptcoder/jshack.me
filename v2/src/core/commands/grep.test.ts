import { describe, expect, it } from 'vitest';
import { grep } from './grep';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { mockCommandEnv, mockFsViewFromTree } from '../../test/factories/commandEnv';
import { asAbsPath } from '../types';
import type { TerminalLine } from './types';

const NO_FLAGS = new Map<string, string | true>();

const textLines = (result: { readonly lines: readonly TerminalLine[] }): string[] =>
  result.lines.filter((line) => line.kind === 'text').map((line) => line.content);

const errorLines = (result: { readonly lines: readonly TerminalLine[] }): string[] =>
  result.lines.filter((line) => line.kind === 'error').map((line) => line.content);

/** ELF magic prefix — content beginning with this sequence is considered
 *  a binary file by legacy grep and should be silently skipped. */
const ELF_STUB = '\x7fELF\x02\x01\x01\x00\x00\x00';

describe('grep — single-file mode', () => {
  it('emits matching lines verbatim and exits 0 when there is a match', async () => {
    const tree = buildDirectory({
      etc: buildDirectory({
        passwd: buildFile(
          'root:x:0:0:root:/root:/bin/bash\nalice:x:1000:1000::/home/alice:/bin/bash\n',
          { owner: 'root', perms: { read: ['root', 'user'], write: ['root'], execute: ['root'] } },
        ),
      }),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/home/alice') }),
    });

    const result = await grep.execute(env, ['root', '/etc/passwd'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['root:x:0:0:root:/root:/bin/bash']);
  });

  it('emits no output and exits 1 when no line matches', async () => {
    const tree = buildDirectory({
      etc: buildDirectory({
        passwd: buildFile('alice:x:1000:1000::/home/alice:/bin/bash\n', {
          owner: 'root',
          perms: { read: ['root', 'user'], write: ['root'], execute: ['root'] },
        }),
      }),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user' }),
    });

    const result = await grep.execute(env, ['zzzzz', '/etc/passwd'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([]);
  });

  it('matches case-insensitively (Password / password / PASSWORD all hit one regex)', async () => {
    // Three lines, three cases — single grep invocation surfaces all three.
    // Catches a "we forgot the 'i' flag" mutant.
    const tree = buildDirectory({
      'config.txt': buildFile(
        'Password=secret\npassword=other\nPASSWORD=third\n',
        { owner: 'alice' },
      ),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/') }),
    });

    const result = await grep.execute(env, ['password', '/config.txt'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual([
      'Password=secret',
      'password=other',
      'PASSWORD=third',
    ]);
  });

  it('treats the pattern as a regex (`.` is any-char, NOT literal dot)', async () => {
    // Pattern `pa.sword` under regex matches `password` (`.` matches `s`).
    // Under literal substring, `password` does NOT contain `pa.sword`.
    // This test fails for the right reason if someone uses `.includes()`.
    const tree = buildDirectory({
      'note.txt': buildFile('password=hunter2\n', { owner: 'alice' }),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/') }),
    });

    const result = await grep.execute(env, ['pa.sword', '/note.txt'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['password=hunter2']);
  });

  it('supports regex character classes (`[abc]` matches lines with a/b/c)', async () => {
    // Belt-and-braces — `[ab]` is a regex char class; literal-substring impls
    // would only match lines containing the literal string `[ab]`.
    const tree = buildDirectory({
      'log.txt': buildFile('alpha\nbravo\ncharlie\nxyz\n', { owner: 'alice' }),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/') }),
    });

    const result = await grep.execute(env, ['[ab]', '/log.txt'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['alpha', 'bravo', 'charlie']);
  });

  it('matches every line when the pattern is empty', async () => {
    // `new RegExp('', 'i').test('anything')` returns true — empty regex
    // matches every position. Real grep matches every line on empty pattern.
    const tree = buildDirectory({
      'log.txt': buildFile('first\nsecond\nthird\n', { owner: 'alice' }),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/') }),
    });

    const result = await grep.execute(env, ['', '/log.txt'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['first', 'second', 'third']);
  });

  it('matches the final line of a file that has NO trailing newline', async () => {
    // Catches an "always-drop-last-segment" mutant in the line-splitter:
    // with content NOT ending in `\n`, the last segment IS a real line
    // and must NOT be dropped. Pattern `match` is on both lines.
    const tree = buildDirectory({
      'note.txt': buildFile('first match\nsecond match', { owner: 'alice' }),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/') }),
    });

    const result = await grep.execute(env, ['match', '/note.txt'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['first match', 'second match']);
  });

  it('emits zero lines and exits 1 for an empty file', async () => {
    const tree = buildDirectory({
      'empty.txt': buildFile('', { owner: 'alice' }),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/') }),
    });

    const result = await grep.execute(env, ['anything', '/empty.txt'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([]);
  });

  it('silently skips binary files (content begins with ELF magic)', async () => {
    // Real grep prints `Binary file <name> matches`; legacy v1 emits empty
    // string. v2 matches legacy: no output, exit 1 (treated like no match).
    // Note: file must be world-readable so the binary check fires AFTER
    // a successful read; otherwise perm-denied wins.
    const tree = buildDirectory({
      bin: buildDirectory(
        {
          ls: buildFile(`${ELF_STUB}password=secret`, {
            owner: 'root',
            perms: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root', 'user', 'guest'] },
          }),
        },
        { owner: 'root' },
      ),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/') }),
    });

    const result = await grep.execute(env, ['password', '/bin/ls'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([]);
  });
});

describe('grep — argument validation', () => {
  it('errors with usage hint when called with no args and exits 2', async () => {
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(buildDirectory({}), { userType: 'user' }),
    });

    const result = await grep.execute(env, [], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(2);
    expect(errorLines(result)).toEqual(['grep: usage: grep <pattern> <path> [-l]']);
  });

  it('errors with usage hint when only the pattern is given (no file, no stdin)', async () => {
    // Slice 3 will replace this with the stdin path when stdin is set; for
    // now, with no stdin in the env, the only-pattern form is a usage error.
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(buildDirectory({}), { userType: 'user' }),
    });

    const result = await grep.execute(env, ['password'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(2);
    expect(errorLines(result)).toEqual(['grep: usage: grep <pattern> <path> [-l]']);
  });

  it('errors with single-quoted path for a missing file and exits 2', async () => {
    // Matches legacy's `grep: '<path>': No such file or directory` shape —
    // single quotes around the path are load-bearing for legacy compat.
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(buildDirectory({}), { userType: 'user' }),
    });

    const result = await grep.execute(env, ['pattern', '/nonexistent'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(2);
    expect(errorLines(result)).toEqual([
      "grep: '/nonexistent': No such file or directory",
    ]);
  });

  it('errors when the file is unreadable for this user (v2 is stricter than legacy here)', async () => {
    // Legacy single-file mode bypassed perm checks; v2's fs.read enforces.
    // This is an explicit divergence documented in the plan.
    const tree = buildDirectory({
      root: buildDirectory(
        {
          secret: buildFile('classified', {
            owner: 'root',
            perms: { read: ['root'], write: ['root'], execute: ['root'] },
          }),
        },
        {
          owner: 'root',
          perms: { read: ['root'], write: ['root'], execute: ['root', 'user'] },
        },
      ),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/') }),
    });

    const result = await grep.execute(env, ['pattern', '/root/secret'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(2);
    expect(errorLines(result)).toEqual([
      "grep: '/root/secret': Permission denied",
    ]);
  });

  it('errors with "invalid regex" when the pattern fails to compile (v2-explicit)', async () => {
    // Legacy threw a SyntaxError from `new RegExp('[', 'i')` — v2 catches
    // and emits an error line + exit 2. Pattern `[` is an unterminated
    // char class.
    const tree = buildDirectory({
      'log.txt': buildFile('anything\n', { owner: 'alice' }),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/') }),
    });

    const result = await grep.execute(env, ['[', '/log.txt'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(2);
    expect(errorLines(result)).toEqual(["grep: invalid regex: '['"]);
  });

  it('resolves relative paths against cwd', async () => {
    // `grep foo log.txt` from /var should resolve to /var/log.txt.
    const tree = buildDirectory({
      var: buildDirectory(
        { 'log.txt': buildFile('important: foo present\nother line\n', { owner: 'alice' }) },
        { owner: 'alice' },
      ),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/var') }),
    });

    const result = await grep.execute(env, ['foo', 'log.txt'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['important: foo present']);
  });
});

describe('grep — directory recursion', () => {
  it('recursively walks a directory and prefixes matches with the filepath', async () => {
    // /etc/passwd has `root:x...`; /home/user/notes.txt has `root password`.
    // Both match `root` and should appear as `<filepath>:<line>` rows.
    const tree = buildDirectory({
      etc: buildDirectory(
        {
          passwd: buildFile('root:x:0:0:root:/root:/bin/bash\nalice:x:1000\n', {
            owner: 'root',
            perms: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] },
          }),
        },
        { owner: 'root' },
      ),
      home: buildDirectory({
        user: buildDirectory(
          { 'notes.txt': buildFile('the root password is secret\nnothing\n', { owner: 'alice' }) },
          { owner: 'alice' },
        ),
      }),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/') }),
    });

    const result = await grep.execute(env, ['root', '/'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual([
      '/etc/passwd:root:x:0:0:root:/root:/bin/bash',
      '/home/user/notes.txt:the root password is secret',
    ]);
  });

  it('sorts results by filepath alphabetically (insertion order intentionally reversed)', async () => {
    // Insertion order [zoo, alpha] — without sorting, output would mirror
    // insertion. With alpha sort: alpha/* comes before zoo/*. Catches a
    // MethodExpression that drops `.sort()`.
    const tree = buildDirectory({
      zoo: buildDirectory(
        { 'z.txt': buildFile('zoo match\n', { owner: 'alice' }) },
        { owner: 'alice' },
      ),
      alpha: buildDirectory(
        { 'a.txt': buildFile('alpha match\n', { owner: 'alice' }) },
        { owner: 'alice' },
      ),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/') }),
    });

    const result = await grep.execute(env, ['match', '/'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(textLines(result)).toEqual([
      '/alpha/a.txt:alpha match',
      '/zoo/z.txt:zoo match',
    ]);
  });

  it('reaches files multiple levels deep', async () => {
    const tree = buildDirectory({
      a: buildDirectory(
        {
          b: buildDirectory(
            {
              c: buildDirectory(
                { 'deep.txt': buildFile('found me\n', { owner: 'alice' }) },
                { owner: 'alice' },
              ),
            },
            { owner: 'alice' },
          ),
        },
        { owner: 'alice' },
      ),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/') }),
    });

    const result = await grep.execute(env, ['found', '/'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['/a/b/c/deep.txt:found me']);
  });

  it('omits files that do not contain matches', async () => {
    const tree = buildDirectory({
      'hit.txt': buildFile('target word here\n', { owner: 'alice' }),
      'miss.txt': buildFile('nothing relevant\n', { owner: 'alice' }),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/') }),
    });

    const result = await grep.execute(env, ['target', '/'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(textLines(result)).toEqual(['/hit.txt:target word here']);
  });

  it('silently skips binary files (ELF) during recursion', async () => {
    // Same magic as in single-file mode. The binary file's content
    // contains `password=secret` but must NOT appear in the output.
    const tree = buildDirectory({
      binary: buildFile(`${ELF_STUB}password=secret`, {
        owner: 'root',
        perms: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root', 'user', 'guest'] },
      }),
      'text.txt': buildFile('password=visible\n', { owner: 'alice' }),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/') }),
    });

    const result = await grep.execute(env, ['password', '/'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(textLines(result)).toEqual(['/text.txt:password=visible']);
  });

  it('silently skips unreadable files (no error line, no exit-code change)', async () => {
    // public.txt is world-readable; private.txt is root-only. The user
    // sees one match, no errors, exit 0 (NOT exit 2 — perm-denied during
    // recursion is silent, unlike single-file mode).
    const tree = buildDirectory({
      'public.txt': buildFile('secret in public\n', {
        owner: 'root',
        perms: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] },
      }),
      'private.txt': buildFile('secret in private\n', {
        owner: 'root',
        perms: { read: ['root'], write: ['root'], execute: ['root'] },
      }),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/') }),
    });

    const result = await grep.execute(env, ['secret', '/'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['/public.txt:secret in public']);
    expect(errorLines(result)).toEqual([]);
  });

  it('silently skips untraversable directories; sibling subtrees still searched', async () => {
    const tree = buildDirectory({
      readable: buildDirectory(
        { 'file.txt': buildFile('find me\n', { owner: 'alice' }) },
        { owner: 'alice' },
      ),
      unreadable: buildDirectory(
        { 'hidden.txt': buildFile('find me too\n', { owner: 'root' }) },
        {
          owner: 'root',
          perms: { read: ['root'], write: ['root'], execute: ['root'] },
        },
      ),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/') }),
    });

    const result = await grep.execute(env, ['find', '/'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // Readable sibling produces a match; unreadable subtree contributes
    // nothing (no error, no leaked content).
    expect(textLines(result)).toEqual(['/readable/file.txt:find me']);
    expect(errorLines(result)).toEqual([]);
  });

  it('lets root read files a user-tier session could not (perm bypass via FsView)', async () => {
    // private.txt is root-only. A root-tier session sees the match;
    // grep code has no root-special-case — FsView's canRead handles it.
    const tree = buildDirectory({
      'private.txt': buildFile('classified intel here\n', {
        owner: 'root',
        perms: { read: ['root'], write: ['root'], execute: ['root'] },
      }),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'root', cwd: asAbsPath('/') }),
    });

    const result = await grep.execute(env, ['classified', '/'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(textLines(result)).toEqual(['/private.txt:classified intel here']);
  });

  it('returns no output and exits 1 for an empty directory', async () => {
    const tree = buildDirectory({
      empty: buildDirectory({}, { owner: 'alice' }),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/') }),
    });

    const result = await grep.execute(env, ['anything', '/empty'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([]);
  });

  it('returns no output and exits 1 when no files in the tree match', async () => {
    const tree = buildDirectory({
      'a.txt': buildFile('alpha\n', { owner: 'alice' }),
      'b.txt': buildFile('beta\n', { owner: 'alice' }),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/') }),
    });

    const result = await grep.execute(env, ['zzzzz', '/'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([]);
  });

  it('resolves `.` to the current cwd and recurses there', async () => {
    // `grep root .` from /home/user descends /home/user only.
    const tree = buildDirectory({
      etc: buildDirectory(
        {
          passwd: buildFile('root:x:0:0\n', {
            owner: 'root',
            perms: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] },
          }),
        },
        { owner: 'root' },
      ),
      home: buildDirectory({
        user: buildDirectory(
          { 'notes.txt': buildFile('root pw here\n', { owner: 'alice' }) },
          { owner: 'alice' },
        ),
      }),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/home/user') }),
    });

    const result = await grep.execute(env, ['root', '.'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // Only `/home/user/notes.txt` is in scope; `/etc/passwd` is NOT searched.
    expect(textLines(result)).toEqual(['/home/user/notes.txt:root pw here']);
  });

  it('preserves single-file behavior when target IS a file (slice 1 regression)', async () => {
    const tree = buildDirectory({
      etc: buildDirectory(
        {
          passwd: buildFile('root:x:0:0\nalice:x:1000\n', {
            owner: 'root',
            perms: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] },
          }),
        },
        { owner: 'root' },
      ),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/') }),
    });

    const result = await grep.execute(env, ['root', '/etc/passwd'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // Single-file mode: NO `<filepath>:` prefix.
    expect(textLines(result)).toEqual(['root:x:0:0']);
  });
});

describe('grep — stdin mode', () => {
  /** Build a stdin AsyncIterable from a fixed line list. */
  const stdinOf = (lines: readonly string[]): AsyncIterable<string> =>
    (async function* () {
      for (const line of lines) yield line;
    })();

  it('reads stdin when called with only the pattern arg', async () => {
    const env = mockCommandEnv({
      stdin: stdinOf(['root:x:0:0', 'alice:x:1000', 'admin:x:1001']),
    });

    const result = await grep.execute(env, ['root'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    // Stdin mode: matching lines verbatim, NO filepath prefix.
    expect(textLines(result)).toEqual(['root:x:0:0']);
  });

  it('emits multiple matching stdin lines in input order', async () => {
    const env = mockCommandEnv({
      stdin: stdinOf(['first match', 'no relevant text', 'second match']),
    });

    const result = await grep.execute(env, ['match'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(textLines(result)).toEqual(['first match', 'second match']);
  });

  it('exits 1 with no output when no stdin line matches', async () => {
    const env = mockCommandEnv({
      stdin: stdinOf(['alpha', 'beta', 'gamma']),
    });

    const result = await grep.execute(env, ['zzz'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([]);
  });

  it('exits 1 for an empty stdin generator', async () => {
    const env = mockCommandEnv({ stdin: stdinOf([]) });

    const result = await grep.execute(env, ['anything'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([]);
  });

  it('matches stdin case-insensitively (regex behavior preserved)', async () => {
    const env = mockCommandEnv({
      stdin: stdinOf(['ROOT', 'user', 'Guest']),
    });

    const result = await grep.execute(env, ['root'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(textLines(result)).toEqual(['ROOT']);
  });

  it('errors with USAGE on zero args even when stdin is piped', async () => {
    // Catches a mutant that drops the `args.length === 0` early-return.
    // Without it, `new RegExp(undefined, 'i')` compiles to `/(?:)/i` (an
    // empty regex matching every line) and grep would leak ALL stdin
    // lines on a bare invocation. The early-return prevents that.
    const env = mockCommandEnv({
      stdin: stdinOf(['secret data should NOT leak']),
    });

    const result = await grep.execute(env, [], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(2);
    expect(errorLines(result)).toEqual(['grep: usage: grep <pattern> <path> [-l]']);
  });

  it('IGNORES stdin when a file arg is also given (file mode wins)', async () => {
    // Real grep / legacy: a path arg means filesystem mode even when piped.
    const tree = buildDirectory({
      'log.txt': buildFile('file alpha\nfile beta\n', { owner: 'alice' }),
    });
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/') }),
      stdin: stdinOf(['stdin alpha', 'stdin beta']),
    });

    const result = await grep.execute(env, ['alpha', '/log.txt'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // Matches come from the FILE, not the stdin generator.
    expect(textLines(result)).toEqual(['file alpha']);
  });
});

describe('grep — -l flag (files-with-matches)', () => {
  const DASH_L = new Map<string, string | true>([['-l', true]]);

  it('emits the filepath when a single file has a match', async () => {
    const tree = buildDirectory({
      etc: buildDirectory(
        {
          passwd: buildFile('root:x:0:0\nalice:x:1000\n', {
            owner: 'root',
            perms: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] },
          }),
        },
        { owner: 'root' },
      ),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/') }),
    });

    const result = await grep.execute(env, ['root', '/etc/passwd'], DASH_L);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['/etc/passwd']);
  });

  it('emits nothing and exits 1 for a single file with no match', async () => {
    const tree = buildDirectory({
      'log.txt': buildFile('nothing relevant\n', { owner: 'alice' }),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/') }),
    });

    const result = await grep.execute(env, ['target', '/log.txt'], DASH_L);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([]);
  });

  it('emits one filepath per matched file in a recursive walk (deduped, sorted)', async () => {
    const tree = buildDirectory({
      etc: buildDirectory(
        {
          passwd: buildFile('root:x:0:0\n', {
            owner: 'root',
            perms: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] },
          }),
          motd: buildFile('Welcome, root\n', {
            owner: 'root',
            perms: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] },
          }),
        },
        { owner: 'root' },
      ),
      home: buildDirectory({
        'notes.txt': buildFile('the root password is secret\n', { owner: 'alice' }),
      }),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/') }),
    });

    const result = await grep.execute(env, ['root', '/'], DASH_L);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual([
      '/etc/motd',
      '/etc/passwd',
      '/home/notes.txt',
    ]);
  });

  it('deduplicates filepaths when a single file has multiple matches', async () => {
    // `multi.txt` has TWO matching lines; -l output must include the
    // filepath ONCE. Catches a "forgot to dedup" mutant.
    const tree = buildDirectory({
      'multi.txt': buildFile('first match\nno match\nsecond match\n', { owner: 'alice' }),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/') }),
    });

    const result = await grep.execute(env, ['match', '/'], DASH_L);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(textLines(result)).toEqual(['/multi.txt']);
  });

  it('emits nothing and exits 1 when no file in the walk matches', async () => {
    const tree = buildDirectory({
      'a.txt': buildFile('alpha\n', { owner: 'alice' }),
      'b.txt': buildFile('beta\n', { owner: 'alice' }),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/') }),
    });

    const result = await grep.execute(env, ['zzz', '/'], DASH_L);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([]);
  });

  it('-l output never contains a `:` separator (regression against lines-mode leakage)', async () => {
    // Catches a "forgot to switch projection" mutant: in default mode the
    // walk emits `<filepath>:<line>`; in -l mode there must be NO colon.
    const tree = buildDirectory({
      etc: buildDirectory(
        {
          passwd: buildFile('root:x:0:0:root:/root:/bin/bash\n', {
            owner: 'root',
            perms: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] },
          }),
        },
        { owner: 'root' },
      ),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/') }),
    });

    const result = await grep.execute(env, ['root', '/'], DASH_L);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // The matched line itself contains `:` characters (passwd format), so
    // the assertion has to be that NO line in -l output ends with `:foo`.
    // Strictest check: result is exactly the filepath, nothing else.
    expect(textLines(result)).toEqual(['/etc/passwd']);
  });
});

describe('grep — stdin + -l (v2-defined: `(standard input)`)', () => {
  const DASH_L = new Map<string, string | true>([['-l', true]]);

  const stdinOf = (lines: readonly string[]): AsyncIterable<string> =>
    (async function* () {
      for (const line of lines) yield line;
    })();

  it('emits `(standard input)` when stdin has any matching line', async () => {
    // Legacy left this combo undefined; v2 matches real GNU grep.
    const env = mockCommandEnv({ stdin: stdinOf(['alpha', 'TARGET line', 'beta']) });

    const result = await grep.execute(env, ['target'], DASH_L);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['(standard input)']);
  });

  it('emits no output and exits 1 when stdin has no matches', async () => {
    const env = mockCommandEnv({ stdin: stdinOf(['alpha', 'beta']) });

    const result = await grep.execute(env, ['zzz'], DASH_L);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual([]);
  });
});
