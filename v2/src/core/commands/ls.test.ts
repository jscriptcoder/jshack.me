import { describe, expect, it } from 'vitest';
import { ls } from './ls';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import {
  mockCommandEnv,
  mockFsViewFromTree,
} from '../../test/factories/commandEnv';
import { asAbsPath } from '../types';
import type { TerminalLine } from './types';

const NO_FLAGS = new Map<string, string | true>();

const textLines = (result: { readonly lines: readonly TerminalLine[] }): string[] =>
  result.lines.filter((line) => line.kind === 'text').map((line) => line.content);

const errorLines = (result: { readonly lines: readonly TerminalLine[] }): string[] =>
  result.lines.filter((line) => line.kind === 'error').map((line) => line.content);

describe('ls', () => {
  it('lists entries of the current working directory when called with no args', async () => {
    const tree = buildDirectory({
      home: buildDirectory({
        alice: buildDirectory(
          {
            'apple.txt': buildFile('a', { owner: 'alice' }),
            'banana.txt': buildFile('b', { owner: 'alice' }),
          },
          { owner: 'alice' },
        ),
      }),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/home/alice') }),
    });

    const result = await ls.execute(env, [], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['apple.txt', 'banana.txt']);
  });

  it('lists the entries of an absolute path argument', async () => {
    const tree = buildDirectory({
      tmp: buildDirectory(
        {
          'alpha.txt': buildFile('a', { owner: 'alice' }),
          'beta.txt': buildFile('b', { owner: 'alice' }),
        },
        { owner: 'alice' },
      ),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/home/alice') }),
    });

    const result = await ls.execute(env, ['/tmp'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['alpha.txt', 'beta.txt']);
  });

  it('resolves a relative path argument against the current cwd', async () => {
    const tree = buildDirectory({
      tmp: buildDirectory(
        {
          sub: buildDirectory(
            { 'nested.txt': buildFile('x', { owner: 'alice' }) },
            { owner: 'alice' },
          ),
        },
        { owner: 'alice' },
      ),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/tmp') }),
    });

    const result = await ls.execute(env, ['sub'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['nested.txt']);
  });

  it('filters hidden entries (names starting with ".") by default', async () => {
    // Catches a BooleanLiteral flip on the hidden-filter predicate. .hidden
    // is FIRST in iteration order so a non-filtering impl would surface it.
    const tree = buildDirectory({
      tmp: buildDirectory(
        {
          '.hidden': buildFile('secret', { owner: 'alice' }),
          'visible.txt': buildFile('shown', { owner: 'alice' }),
        },
        { owner: 'alice' },
      ),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/tmp') }),
    });

    const result = await ls.execute(env, [], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(textLines(result)).toEqual(['visible.txt']);
  });

  it('sorts entries alphabetically regardless of insertion order', async () => {
    // Catches a MethodExpression mutator that drops `.sort()` — without
    // sorting, the result would mirror Map insertion order.
    const tree = buildDirectory({
      tmp: buildDirectory(
        {
          zebra: buildFile('z', { owner: 'alice' }),
          apple: buildFile('a', { owner: 'alice' }),
          mango: buildFile('m', { owner: 'alice' }),
        },
        { owner: 'alice' },
      ),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/tmp') }),
    });

    const result = await ls.execute(env, [], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(textLines(result)).toEqual(['apple', 'mango', 'zebra']);
  });

  it('emits no output for an empty directory and exits 0', async () => {
    // Catches StringLiteral / ArrayDeclaration mutants that would inject a
    // header or trailing empty line into the listing.
    const tree = buildDirectory({
      tmp: buildDirectory({}, { owner: 'alice' }),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/tmp') }),
    });

    const result = await ls.execute(env, [], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([]);
  });

  it('echoes the input path when the target is a regular file', async () => {
    // Matches real `ls /etc/passwd` — file targets print the input path,
    // not the contents. Exit 0 (the file exists).
    const tree = buildDirectory({
      etc: buildDirectory(
        { passwd: buildFile('root:x:0:0::/root:/bin/bash\n', { owner: 'root' }) },
        { owner: 'root' },
      ),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/home/alice') }),
    });

    const result = await ls.execute(env, ['/etc/passwd'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['/etc/passwd']);
  });

  it('reports "cannot access" for a missing target and exits 2', async () => {
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(buildDirectory({}), { userType: 'user' }),
    });

    const result = await ls.execute(env, ['/nope'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(2);
    expect(errorLines(result)).toEqual([
      "ls: cannot access '/nope': No such file or directory",
    ]);
  });

  it('reports "cannot open directory" when the directory is unreadable and exits 2', async () => {
    // /root with perms read: ['root']. A user-tier session gets
    // permission_denied from fs.list.
    const tree = buildDirectory({
      root: buildDirectory(
        {},
        {
          owner: 'root',
          perms: { read: ['root'], write: ['root'], execute: ['root'] },
        },
      ),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/') }),
    });

    const result = await ls.execute(env, ['/root'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(2);
    expect(errorLines(result)).toEqual([
      "ls: cannot open directory '/root': Permission denied",
    ]);
  });

  it('echoes the ORIGINAL arg in error messages (not the resolved abs path)', async () => {
    // Catches an "always use resolved path" bug. `ls nope` from /home/alice
    // resolves to /home/alice/nope, but the error should say 'nope'.
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(buildDirectory({}), {
        userType: 'user',
        cwd: asAbsPath('/home/alice'),
      }),
    });

    const result = await ls.execute(env, ['nope'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(2);
    expect(errorLines(result)).toEqual([
      "ls: cannot access 'nope': No such file or directory",
    ]);
  });
});

describe('ls -a (show hidden)', () => {
  it('includes entries starting with `.` and surfaces synthetic `.` and `..`', async () => {
    // Without -a (Slice 2): `.hidden` is filtered, `.` and `..` are never
    // emitted. With -a: all four show, sorted as `.`, `..`, `.hidden`,
    // `visible.txt` (ASCII: `.` < `..` < `.h` < `v`).
    const tree = buildDirectory({
      tmp: buildDirectory(
        {
          '.hidden': buildFile('s', { owner: 'alice' }),
          'visible.txt': buildFile('v', { owner: 'alice' }),
        },
        { owner: 'alice' },
      ),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/tmp') }),
    });

    const result = await ls.execute(env, [], new Map([['-a', true]]));

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual(['.', '..', '.hidden', 'visible.txt']);
  });

  it('emits `.` and `..` even for an empty directory', async () => {
    // Catches a "synthesize only when there are hidden entries" mutant.
    const tree = buildDirectory({
      tmp: buildDirectory({}, { owner: 'alice' }),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/tmp') }),
    });

    const result = await ls.execute(env, [], new Map([['-a', true]]));

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(textLines(result)).toEqual(['.', '..']);
  });
});

describe('ls -l (long format)', () => {
  it('renders one row per file: <type><perms9> <owner> <size> <name>', async () => {
    // notes.txt: alice-owned, default file perms — read: ['root','user'],
    // write: ['root','user'], execute: ['root']. Tier-truthful mapping:
    //   root  rwx
    //   user  rw-
    //   guest ---
    // Type char `-` (file). Owner `alice`. Size = content.length.
    const content = 'hello\nfrom alice\n'; // 17 bytes
    const tree = buildDirectory({
      home: buildDirectory({
        alice: buildDirectory(
          { 'notes.txt': buildFile(content, { owner: 'alice' }) },
          { owner: 'alice' },
        ),
      }),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/home/alice') }),
    });

    const result = await ls.execute(env, [], new Map([['-l', true]]));

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual([
      `-rwxrw---- alice ${content.length} notes.txt`,
    ]);
  });

  it('uses `d` as the type char for directories and reports size 4096', async () => {
    // sub is a directory — default dir perms world-readable + traversable,
    // owner-tier writes. Owner 'alice' → tier 'user'. Default dir perms:
    //   read: all tiers; write: ['root', 'user']; execute: all tiers.
    // → root rwx, user rwx, guest r-x → `drwxrwxr-x`.
    // Size for directory: 4096 (Unix convention).
    const tree = buildDirectory({
      home: buildDirectory({
        alice: buildDirectory(
          { sub: buildDirectory({}, { owner: 'alice' }) },
          { owner: 'alice' },
        ),
      }),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/home/alice') }),
    });

    const result = await ls.execute(env, [], new Map([['-l', true]]));

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(textLines(result)).toEqual(['drwxrwxr-x alice 4096 sub']);
  });

  it('maps tier-allowlist perms to a 9-char rwx string in root/user/guest order', async () => {
    // Each test row exercises a different combination so every position in
    // the 9-char string is independently asserted. This is the table that
    // locks in the tier-truthful mapping (Option A from the AC discussion).
    const tree = buildDirectory({
      tmp: buildDirectory(
        {
          // root rwx, user ---, guest --- → -rwx------
          rootonly: buildFile('a', {
            owner: 'root',
            perms: { read: ['root'], write: ['root'], execute: ['root'] },
          }),
          // root rwx, user rwx, guest rwx → -rwxrwxrwx
          world: buildFile('b', {
            owner: 'root',
            perms: {
              read: ['root', 'user', 'guest'],
              write: ['root', 'user', 'guest'],
              execute: ['root', 'user', 'guest'],
            },
          }),
          // root r--, user --w, guest --x → -r---w---x (locks each position)
          mixed: buildFile('c', {
            owner: 'root',
            perms: { read: ['root'], write: ['user'], execute: ['guest'] },
          }),
        },
        { owner: 'root' },
      ),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/tmp') }),
    });

    const result = await ls.execute(env, [], new Map([['-l', true]]));

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    const long = textLines(result);
    expect(long).toContain('-r---w---x root 1 mixed');
    expect(long).toContain('-rwx------ root 1 rootonly');
    expect(long).toContain('-rwxrwxrwx root 1 world');
  });

  it('renders a single row for a file target (matches real `ls -l /etc/passwd`)', async () => {
    // ls -l /etc/passwd should print one long-format row with the input
    // path as the name (NOT just `passwd`).
    const tree = buildDirectory({
      etc: buildDirectory(
        {
          passwd: buildFile('root:x:0:0::/root:/bin/bash\n', {
            owner: 'root',
            perms: { read: ['root', 'user'], write: ['root'], execute: ['root'] },
          }),
        },
        { owner: 'root' },
      ),
    });

    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/home/alice') }),
    });

    const result = await ls.execute(env, ['/etc/passwd'], new Map([['-l', true]]));

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(textLines(result)).toEqual([
      `-rwxr----- root 28 /etc/passwd`,
    ]);
  });
});

describe('ls -la (stacking)', () => {
  /** Shared fixture. Insertion order is INTENTIONALLY reversed from
   *  alphabetical (`visible.txt` first, `.hidden` second) so the sort
   *  step in -a's `[synthetic, ...real].sort()` actually does work —
   *  catches a `MethodExpression` mutant that drops `.sort()` and
   *  returns entries in insertion order. */
  const buildStackingFs = () =>
    buildDirectory({
      tmp: buildDirectory(
        {
          'visible.txt': buildFile('v', { owner: 'alice' }),
          '.hidden': buildFile('s', { owner: 'alice' }),
        },
        { owner: 'alice' },
      ),
    });

  it('`-la` (stacked) applies BOTH -l and -a', async () => {
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(buildStackingFs(), {
        userType: 'user',
        cwd: asAbsPath('/tmp'),
      }),
    });

    // Direct invocation: simulate what the parser does for `-la` —
    // expand into the flags Map as if -l + -a were both set. Stacking
    // expansion is verified end-to-end in `runLine.test.ts`; here we
    // assert ls's response to the resulting Map.
    const result = await ls.execute(
      env,
      [],
      new Map<string, string | true>([
        ['-l', true],
        ['-a', true],
      ]),
    );

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // ASCII sort: `.` < `..` < `.hidden` < `visible.txt`. `.` reflects
    // the listed dir (/tmp, owned by alice). `..` reflects its parent
    // (/, owned by root with default dir perms).
    expect(textLines(result)).toEqual([
      'drwxrwxr-x alice 4096 .',
      'drwxr-xr-x root 4096 ..',
      '-rwxrw---- alice 1 .hidden',
      '-rwxrw---- alice 1 visible.txt',
    ]);
  });
});

describe('ls -la (stacked, parsed end-to-end)', () => {
  // Stacking expansion is exercised through the shell parser. Verifies the
  // parser stack-expansion AND ls's response, in one shot.
  it('parses `ls -la` into the same Map as `ls -l -a`', async () => {
    // Imported here to keep the prior describes pure-unit.
    const { runCommandLine } = await import('../shell/runLine');
    const { ls: realLs } = await import('./ls');
    const tree = buildDirectory({
      home: buildDirectory({
        alice: buildDirectory(
          {
            '.bashrc': buildFile('export PATH=$PATH\n', { owner: 'alice' }),
            'readme.txt': buildFile('hi\n', { owner: 'alice' }),
          },
          { owner: 'alice' },
        ),
      }),
    });
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(tree, {
        userType: 'user',
        cwd: asAbsPath('/home/alice'),
      }),
    });
    const commands = new Map([['ls', realLs]]);

    const stacked = await runCommandLine(env, 'ls -la', commands);
    const separate = await runCommandLine(env, 'ls -l -a', commands);
    const altOrder = await runCommandLine(env, 'ls -al', commands);

    // All three forms produce IDENTICAL output — the contract for stacking.
    expect(stacked).toEqual(separate);
    expect(stacked).toEqual(altOrder);
  });

  it('rejects `cat -na` — cat does NOT opt into stacking (regression)', async () => {
    const { runCommandLine } = await import('../shell/runLine');
    const { cat } = await import('./cat');
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(buildDirectory({}), { userType: 'user' }),
    });

    const result = await runCommandLine(env, 'cat -na notes.txt', new Map([['cat', cat]]));

    // cat's flag spec includes -n but NOT -a; stacking is off. -na is
    // unrecognized literally. If someone accidentally toggles cat's
    // stacking on, this test fails.
    expect(result).toEqual({
      kind: 'sync',
      lines: [{ kind: 'error', content: 'cat: unrecognized option: -na' }],
      exitCode: 2,
    });
  });
});
