import { describe, expect, it } from 'vitest';
import { find } from './find';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { mockCommandEnv, mockFsViewFromTree } from '../../test/factories/commandEnv';
import { asAbsPath } from '../types';
import type { TerminalLine } from './types';
import type { Directory } from '../filesystem/types';

const NO_FLAGS = new Map<string, string | true>();

const textLines = (result: { readonly lines: readonly TerminalLine[] }): string[] =>
  result.lines.filter((line) => line.kind === 'text').map((line) => line.content);

const errorLines = (result: { readonly lines: readonly TerminalLine[] }): string[] =>
  result.lines.filter((line) => line.kind === 'error').map((line) => line.content);

/** A box with one door the user tier cannot open. `/vault` is root-only —
 *  unreadable and untraversable — and holds a file whose very NAME is the
 *  thing a locked directory exists to keep private. Everything else is
 *  ordinary and readable, so a walk that respects the door still has plenty
 *  to report and the test cannot pass by finding nothing. */
const boxWithALockedRoom = () =>
  buildDirectory({
    etc: buildDirectory({
      passwd: buildFile('root:x:0:0:root:/root:/bin/bash\n', { owner: 'root' }),
    }),
    vault: buildDirectory(
      {
        'passwd.bak': buildFile('root:$1$realhash\n', { owner: 'root' }),
      },
      { owner: 'root', perms: { read: ['root'], write: ['root'], execute: ['root'] } },
    ),
  });

describe('find — what the session may not see', () => {
  it('reports nothing from inside a directory the session cannot enter', async () => {
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(boxWithALockedRoom(), {
        userType: 'user',
        cwd: asAbsPath('/'),
      }),
    });

    const result = await find.execute(env, ['/', 'passwd*'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;

    // The whole point of the command's walk. `env.fs.stat` answers with no
    // permission check at all, so a find that enumerated through it would
    // hand a user-tier player the contents of every root-only directory on
    // the box — turning a convenience tool into an oracle for exactly what
    // someone bothered to lock away.
    expect(textLines(result)).not.toContain('/vault/passwd.bak');
    expect(textLines(result)).toContain('/etc/passwd');

    // A locked door is not an error and does not fail the search: the player
    // asked what is findable, and the answer is complete for what they can
    // reach. Reporting a denial per skipped directory would leak the same
    // secret one sentence later.
    expect(errorLines(result)).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  it('still names the locked directory itself, which its parent listing already shows', async () => {
    const env = mockCommandEnv({
      fs: mockFsViewFromTree(boxWithALockedRoom(), {
        userType: 'user',
        cwd: asAbsPath('/'),
      }),
    });

    const result = await find.execute(env, ['/', 'vault'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;

    // The boundary has to be precise in both directions. `ls /` already names
    // `vault`, so hiding it from find would be a lie about the shape of the
    // box rather than a kept secret — and it would make the two commands
    // disagree about the same directory. What is private is what is INSIDE.
    expect(textLines(result)).toEqual(['/vault/']);
  });
});

/** Run `find` over a tree as a user-tier session standing at `/`. The trees
 *  below differ only in shape, so the setup is not worth repeating three
 *  times — what each test varies is the tree and the pattern. */
const findIn = (tree: Directory, args: readonly string[]) =>
  find.execute(
    mockCommandEnv({ fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/') }) }),
    args,
    NO_FLAGS,
  );

describe('find — what it reports, and in what order', () => {
  it('finds a match several directories down and prints its absolute path', async () => {
    const tree = buildDirectory({
      var: buildDirectory({
        www: buildDirectory({
          html: buildDirectory({
            'index.html': buildFile('<h1>hello</h1>', { owner: 'www-data' }),
          }),
        }),
      }),
    });

    const result = await findIn(tree, ['/', '*.html']);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // Depth is the point: a walk that only looked one level down would find
    // nothing here and still exit 0, which reads as "no such file" rather
    // than as a broken command.
    expect(textLines(result)).toEqual(['/var/www/html/index.html']);
  });

  it('names a matching directory before the entries inside it', async () => {
    const tree = buildDirectory({
      var: buildDirectory({
        logs: buildDirectory({
          'logs.txt': buildFile('nothing happened\n', { owner: 'root' }),
        }),
      }),
    });

    const result = await findIn(tree, ['/', 'logs*']);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // A container reads before its contents, the way a listing does — and the
    // trailing slash is what tells the two apart at a glance, since a player
    // reading this output is deciding what to `cat` and what to `cd` into.
    expect(textLines(result)).toEqual(['/var/logs/', '/var/logs/logs.txt']);
  });

  it('orders each directory alphabetically, whatever order the tree holds', async () => {
    const tree = buildDirectory({
      etc: buildDirectory({
        'zulu.cfg': buildFile('z\n', { owner: 'root' }),
        'alpha.cfg': buildFile('a\n', { owner: 'root' }),
        'mike.cfg': buildFile('m\n', { owner: 'root' }),
      }),
    });

    const result = await findIn(tree, ['/', '*.cfg']);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // The tree holds these in the order they were written, which is not the
    // order anyone wants to read. Without an explicit sort the output would
    // be stable, plausible and different on a box built in another order.
    expect(textLines(result)).toEqual(['/etc/alpha.cfg', '/etc/mike.cfg', '/etc/zulu.cfg']);
  });
});

/** A flat directory of files whose names differ only in the ways a glob is
 *  supposed to care about. Each test below picks its pattern so that the
 *  near-misses are present and must be left out. */
const filesNamed = (...names: readonly string[]): Directory =>
  buildDirectory(Object.fromEntries(names.map((name) => [name, buildFile('x\n', { owner: 'root' })])));

describe('find — the pattern is a glob, not a regex', () => {
  it('expands * to any run of characters, including none at all', async () => {
    const result = await findIn(filesNamed('.log', 'error.log', 'log', 'x.log'), ['/', '*.log']);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // `.log` proves the run may be empty; `log` proves the dot is required
    // and not swallowed by the wildcard beside it.
    expect(textLines(result)).toEqual(['/.log', '/error.log', '/x.log']);
  });

  it('expands ? to exactly one character, never zero and never two', async () => {
    const result = await findIn(filesNamed('passw', 'passwd', 'passwrd'), ['/', 'passw?']);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(textLines(result)).toEqual(['/passwd']);
  });

  it('treats every other metacharacter as itself, so *.txt does not match axtxt', async () => {
    const result = await findIn(filesNamed('a.txt', 'axtxt', 'notes.txt'), ['/', '*.txt']);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // The one test that separates a glob from a regex. A pattern handed
    // straight to `new RegExp` reads `.` as "any character" and quietly
    // returns files a player never asked for — believable output, wrong
    // answer, and no error to notice.
    expect(textLines(result)).toEqual(['/a.txt', '/notes.txt']);
  });

  it('matches whole names, so passwd finds neither oldpasswd nor passwd.bak', async () => {
    const result = await findIn(filesNamed('oldpasswd', 'passwd', 'passwd.bak'), ['/', 'passwd']);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // Both ends at once: an unanchored pattern would drag in the prefixed
    // name at the front and the suffixed one at the back.
    expect(textLines(result)).toEqual(['/passwd']);
  });
});

/** A box with two owners and one locked room. `/vault` is root-only and holds
 *  a file owned by alice — so an owner filter that reached for the tree rather
 *  than for the listing would hand alice's own name back as the key to it. */
const boxWithTwoOwners = (): Directory =>
  buildDirectory({
    home: buildDirectory(
      {
        alice: buildDirectory(
          {
            'notes.txt': buildFile('hello\n', { owner: 'alice' }),
            'report.log': buildFile('audit\n', { owner: 'root' }),
          },
          { owner: 'alice' },
        ),
      },
      { owner: 'root' },
    ),
    vault: buildDirectory(
      { 'alice-backup.txt': buildFile('hers, kept elsewhere\n', { owner: 'alice' }) },
      { owner: 'root', perms: { read: ['root'], write: ['root'], execute: ['root'] } },
    ),
  });

describe('find — the owner filter reports, it does not authorize', () => {
  it('keeps only the entries owned by the named user', async () => {
    const result = await findIn(boxWithTwoOwners(), ['/', '*', 'alice']);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // Directories are filtered by owner too — `/home/` belongs to root and
    // drops out, while `/home/alice/` stays. The pattern matched all five
    // reachable entries; the owner is what narrows them to two.
    expect(textLines(result)).toEqual(['/home/alice/', '/home/alice/notes.txt']);
  });

  it('opens nothing by naming its owner — the locked room stays shut', async () => {
    const result = await findIn(boxWithTwoOwners(), ['/', '*', 'root']);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // `/vault/` is root-owned and listed, because its parent already showed
    // the name. What is inside it is not, and asking as the owner of the room
    // changes nothing: the filter narrows the results of a walk that has
    // already decided where it may go. An owner-driven search that widened
    // the walk would be a lockpick with a spelling requirement.
    expect(textLines(result)).toEqual(['/home/', '/home/alice/report.log', '/vault/']);
  });

  it('cannot be aimed into the locked room by naming the file and its owner', async () => {
    const result = await findIn(boxWithTwoOwners(), ['/', 'alice-backup.txt', 'alice']);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // The sharpest form of the claim: the file exists, the owner is right,
    // the name is exact — and it is behind a door this session cannot open,
    // so the answer is nothing. Knowing what to ask for is not permission.
    expect(textLines(result)).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  it('reports nothing, successfully, when no entry has that owner', async () => {
    const result = await findIn(boxWithTwoOwners(), ['/', '*', 'www-data']);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // An empty answer is an answer: the player asked a well-formed question
    // and the box has nothing matching. Nothing to report, nothing to fail.
    expect(textLines(result)).toEqual([]);
    expect(result.exitCode).toBe(0);
  });
});

describe('find — what it refuses, and what it merely finds nothing in', () => {
  it('refuses without both operands, naming the shape it wants', async () => {
    const tree = filesNamed('passwd');

    const noOperands = await findIn(tree, []);
    const onlyAPath = await findIn(tree, ['/']);

    expect(noOperands.kind).toBe('sync');
    expect(onlyAPath.kind).toBe('sync');
    if (noOperands.kind !== 'sync' || onlyAPath.kind !== 'sync') return;
    // A pattern is not optional and cannot be defaulted: `find /` with an
    // implied `*` would walk a whole box to print it back.
    expect(errorLines(noOperands)).toEqual(['find: usage: find <path> <pattern> [user]']);
    expect(errorLines(onlyAPath)).toEqual(['find: usage: find <path> <pattern> [user]']);
    expect(noOperands.exitCode).toBe(1);
    expect(onlyAPath.exitCode).toBe(1);
  });

  it('reports a start path that is not there, in the words the player typed', async () => {
    const result = await findIn(filesNamed('passwd'), ['nope', '*']);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // `nope`, not `/nope`. The player is told about the thing they asked for;
    // echoing the resolved path back would make a typo in a relative path
    // read as a bug in the shell's cwd.
    expect(errorLines(result)).toEqual(["find: 'nope': No such file or directory"]);
    expect(textLines(result)).toEqual([]);
    expect(result.exitCode).toBe(1);
  });

  it('refuses to search inside a file', async () => {
    const result = await findIn(filesNamed('passwd'), ['/passwd', '*']);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // Distinct from "not there" on purpose: the difference between a name
    // that is wrong and a name that is right but not searchable is the whole
    // of what the player needs to do next.
    expect(errorLines(result)).toEqual(["find: '/passwd': Not a directory"]);
    expect(result.exitCode).toBe(1);
  });

  it('finds nothing without failing', async () => {
    const result = await findIn(filesNamed('passwd', 'hosts'), ['/', '*.conf']);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // Real find exits 0 with no matches, and so does this: an empty answer is
    // an answer. Exiting non-zero would make `find ... || echo missing` fire
    // for a perfectly successful search.
    expect(textLines(result)).toEqual([]);
    expect(errorLines(result)).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  it('treats a start path it cannot enter exactly as it treats one found mid-walk', async () => {
    const result = await findIn(boxWithALockedRoom(), ['/vault', '*']);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // Not an error, deliberately, and worth stating rather than leaving to
    // fall out of the code: one rule about an unreadable directory, applied
    // wherever the walk meets it. Naming it on the command line does not buy
    // a different answer than walking into it.
    expect(textLines(result)).toEqual([]);
    expect(errorLines(result)).toEqual([]);
    expect(result.exitCode).toBe(0);
  });
});

/** The same run, from somewhere other than `/` — these tests are about where
 *  the search starts, so the cwd is the variable rather than a constant. */
const findStandingAt = (cwd: string, tree: Directory, args: readonly string[]) =>
  find.execute(
    mockCommandEnv({ fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath(cwd) }) }),
    args,
    NO_FLAGS,
  );

/** Decoys at the root with the same names as the files under /home/alice. A
 *  search that ignored the cwd and started at / would find these too, so each
 *  test below fails on its exact-array assertion rather than passing by luck. */
const boxWithDecoysAtRoot = (): Directory =>
  buildDirectory({
    'notes.txt': buildFile('decoy\n', { owner: 'root' }),
    'report.log': buildFile('decoy\n', { owner: 'root' }),
    home: buildDirectory(
      {
        alice: buildDirectory(
          {
            'notes.txt': buildFile('hers\n', { owner: 'alice' }),
            'report.log': buildFile('hers\n', { owner: 'alice' }),
          },
          { owner: 'alice' },
        ),
      },
      { owner: 'root' },
    ),
  });

describe('find — where the search starts', () => {
  it('searches from where the session is standing when handed a dot', async () => {
    const result = await findStandingAt('/home/alice', boxWithDecoysAtRoot(), ['.', '*.txt']);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // Absolute on the way out, whatever went in. A player pipes this into
    // `cat` or reads it after `cd`-ing somewhere else, and a `./notes.txt`
    // would be right only for as long as they stood still.
    expect(textLines(result)).toEqual(['/home/alice/notes.txt']);
  });

  it('reads a bare name as relative to the cwd, not to the root', async () => {
    const result = await findStandingAt('/home', boxWithDecoysAtRoot(), ['alice', '*.txt']);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // `/home/alice`, not `/alice` — which does not exist, so a start path
    // treated as absolute would answer "No such file or directory" and look
    // like the box was missing a directory the player can plainly see.
    expect(textLines(result)).toEqual(['/home/alice/notes.txt']);
  });

  it('climbs with .. before it descends', async () => {
    const result = await findStandingAt('/home/alice', boxWithDecoysAtRoot(), ['..', '*.log']);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    // Started at `/home`, walked back down into alice's directory to find the
    // file — so the climb happens once, up front, and does not follow the
    // walk around.
    expect(textLines(result)).toEqual(['/home/alice/report.log']);
  });
});
