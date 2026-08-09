import { describe, expect, it } from 'vitest';
import { john } from './john';
import { mockCommandEnv, mockFsViewFromTree, mockSession } from '../../test/factories/commandEnv';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { md5 } from '../generation/md5';
import { asAbsPath, asMachineId, type UserType } from '../types';
import type { CommandResult, TerminalLine } from './types';
import type { Directory } from '../filesystem/types';

/**
 * `john` recovers passwords from hashes the player already holds, and the whole
 * reason it exists is what it does NOT do: it never contacts the box those
 * hashes came from. A hydra sweep writes one `auth.log` line per password tried;
 * this writes nothing anywhere. Same wordlist, same md5, same answers — the only
 * difference is that nobody sees it, so these tests guard the silence as
 * carefully as the cracking.
 *
 * The env factory helps here rather than getting in the way: its `patches` API
 * throws on any write and its network reports offline, so every test below is
 * already proof that a run needs neither.
 */

const TARGET_PATH = '/home/alice/hashes.txt';
const WORDLIST_PATH = '/usr/share/wordlists/passwords.txt';

/** A passwd row as the player would have copied it off a cracked box — the hash
 *  sits inline, since this world has no `/etc/shadow`. */
const passwdRow = (username: string, password: string): string =>
  `${username}:${md5(password)}:1000:1000::/home/${username}:/bin/bash`;

/** A row whose second field is a placeholder rather than a hash — a locked or
 *  shadowed account, which has nothing to crack. */
const placeholderRow = (username: string, placeholder: string): string =>
  `${username}:${placeholder}:1000:1000::/home/${username}:/bin/bash`;

type EnvOpts = {
  readonly target?: string | null;
  readonly wordlist?: readonly string[] | null;
  readonly userType?: UserType;
  readonly targetReadableBy?: readonly UserType[];
  readonly machineId?: string;
};

const treeWith = (opts: EnvOpts): Directory => {
  const wordlistFile =
    opts.wordlist === null
      ? {}
      : {
          'passwords.txt': buildFile((opts.wordlist ?? ['letmein']).join('\n'), {
            perms: { read: ['root', 'user', 'guest'] },
          }),
        };
  const targetFile =
    opts.target === null
      ? {}
      : {
          'hashes.txt': buildFile(opts.target ?? passwdRow('deploy', 'letmein'), {
            owner: 'alice',
            ...(opts.targetReadableBy === undefined
              ? {}
              : { perms: { read: opts.targetReadableBy } }),
          }),
        };
  return buildDirectory({
    usr: buildDirectory({
      share: buildDirectory({ wordlists: buildDirectory(wordlistFile) }),
    }),
    home: buildDirectory({
      alice: buildDirectory({ ...targetFile, projects: buildDirectory({}) }, { owner: 'alice' }),
    }),
  });
};

const johnEnv = (opts: EnvOpts = {}) => {
  const userType = opts.userType ?? 'user';
  return mockCommandEnv({
    session: mockSession({
      userType,
      machineId: asMachineId(opts.machineId ?? 'localhost'),
    }),
    fs: mockFsViewFromTree(treeWith(opts), { userType, cwd: asAbsPath('/home/alice') }),
  });
};

const run = async (
  env: ReturnType<typeof johnEnv>,
  args: readonly string[],
): Promise<{ readonly text: string; readonly kinds: readonly string[]; readonly code: number }> => {
  const result: CommandResult = await john.execute(env, args, new Map());
  if (result.kind === 'sync') {
    return {
      text: result.lines.map((line) => line.content).join('\n'),
      kinds: result.lines.map((line) => line.kind),
      code: result.exitCode,
    };
  }
  if (result.kind !== 'async') throw new Error(`unexpected result kind: ${result.kind}`);
  const lines: TerminalLine[] = [];
  for await (const line of result.lines) lines.push(line);
  return {
    text: lines.map((line) => line.content).join('\n'),
    kinds: lines.map((line) => line.kind),
    code: await result.exitCode(),
  };
};

describe('john recovers passwords from hashes the player already holds', () => {
  it('reports the account and its password when the hash is in the wordlist', async () => {
    // The matching word sits in the MIDDLE of the list: a match in the last
    // position lets an off-by-one over the wordlist pass unnoticed.
    const env = johnEnv({
      wordlist: ['hunter2', 'letmein', 'trustno1'],
      target: passwdRow('deploy', 'letmein'),
    });

    const { text, code } = await run(env, ['hashes.txt']);

    expect(text).toContain('deploy:letmein');
    expect(text).toContain('1/1 password hash cracked');
    expect(code).toBe(0);
  });

  it('counts a hash the wordlist cannot reach without naming it', async () => {
    // The account HELD. That is a fact about the player's wordlist, and it must
    // not be silently dropped — the denominator is what tells them to go and
    // harvest more words.
    const env = johnEnv({
      wordlist: ['hunter2', 'trustno1'],
      target: passwdRow('root', 'correct-horse-battery'),
    });

    const { text, code } = await run(env, ['hashes.txt']);

    expect(text).not.toContain('root:');
    expect(text).toContain('0/1 password hash cracked');
    expect(code).toBe(0);
  });

  it('cracks the reachable rows of a mixed file and counts every row it tried', async () => {
    const env = johnEnv({
      wordlist: ['letmein'],
      target: [passwdRow('root', 'correct-horse-battery'), passwdRow('deploy', 'letmein')].join(
        '\n',
      ),
    });

    const { text } = await run(env, ['hashes.txt']);

    expect(text).toContain('deploy:letmein');
    expect(text).not.toContain('root:');
    expect(text).toContain('1/2 password hashes cracked');
  });

  it('matches a hash in full rather than by prefix', async () => {
    // A truncated hash is not this password's hash. Comparing loosely would hand
    // the player a credential `su` then rejects, which reads as a broken game.
    const truncated = md5('letmein').slice(0, 20);
    const env = johnEnv({
      wordlist: ['letmein'],
      target: `deploy:${truncated}:1000:1000::/home/deploy:/bin/bash`,
    });

    const { text } = await run(env, ['hashes.txt']);

    expect(text).not.toContain('deploy:letmein');
    expect(text).toContain('0/1 password hash cracked');
  });

  it('reads the wordlist from the box it is standing on, whichever box that is', async () => {
    // The player's machine is somewhere they operate FROM, not the only place
    // the toolchain exists. Standing on a cracked NPC box with a wordlist on it,
    // john works exactly as it does at home.
    const env = johnEnv({
      machineId: 'npc-box-a1b2c3',
      wordlist: ['letmein'],
      target: passwdRow('deploy', 'letmein'),
    });

    const { text, code } = await run(env, ['hashes.txt']);

    expect(text).toContain('deploy:letmein');
    expect(code).toBe(0);
  });

  it('completes with no network and no write to any machine', async () => {
    // Silence is the whole product difference from hydra. The env's patch API
    // throws on any write and reports offline, so reaching for either fails here.
    const env = johnEnv({ wordlist: ['letmein'], target: passwdRow('deploy', 'letmein') });
    expect(env.network.isOnline()).toBe(false);

    const { text, code } = await run(env, ['hashes.txt']);

    expect(text).toContain('deploy:letmein');
    expect(code).toBe(0);
  });

  it('resolves a relative path against the working directory', async () => {
    const env = johnEnv({ wordlist: ['letmein'], target: passwdRow('deploy', 'letmein') });

    const { text } = await run(env, [TARGET_PATH]);

    expect(text).toContain('deploy:letmein');
  });
});

describe('john reading a file that is not a clean list of hashes', () => {
  it('ignores blank lines, trailing newlines and comments', async () => {
    // The comment carries a colon, as a note about where the rows came from
    // naturally would. Split on `:` it looks exactly like a passwd row, so only
    // the leading `#` tells them apart — counting it would invent an account.
    const env = johnEnv({
      wordlist: ['letmein'],
      target: `# harvested from 192.168.4.31:22\n\n${passwdRow('deploy', 'letmein')}\n`,
    });

    const { text } = await run(env, ['hashes.txt']);

    expect(text).toContain('1/1 password hash cracked');
  });

  it.each([
    ['x', 'a shadowed account'],
    ['*', 'a locked account'],
    ['!!', 'an account with no password set'],
    ['', 'a row with an empty password field'],
  ])('skips %s rather than counting it as a hash that held (%s)', async (placeholder) => {
    // A placeholder is not a hash that resisted the wordlist — it is a row with
    // nothing to crack. Counting it would understate how well the player's list
    // is doing and invent work they cannot act on.
    const env = johnEnv({
      wordlist: ['letmein'],
      target: [placeholderRow('svc', placeholder), passwdRow('deploy', 'letmein')].join('\n'),
    });

    const { text } = await run(env, ['hashes.txt']);

    expect(text).toContain('1/1 password hash cracked');
  });

  it('refuses a file that holds no usable hashes at all', async () => {
    const env = johnEnv({ wordlist: ['letmein'], target: 'not a passwd file\n# just notes\n' });

    const { text, kinds, code } = await run(env, ['hashes.txt']);

    expect(text).toBe('john: hashes.txt: No password hashes found');
    expect(kinds).toEqual(['error']);
    expect(code).toBe(1);
  });

  it('ignores blank lines in the wordlist rather than trying the empty password', async () => {
    const env = johnEnv({
      wordlist: ['', 'letmein', ''],
      target: passwdRow('deploy', 'letmein'),
    });

    const { text } = await run(env, ['hashes.txt']);

    expect(text).toContain('deploy:letmein');
    expect(text).toContain('Loaded 1 words into wordlist');
  });
});

describe('john refusing a run, each for its own stated reason', () => {
  it('names the missing operand', async () => {
    const { text, kinds, code } = await run(johnEnv(), []);

    expect(text).toBe('john: missing file operand — usage: john <file>');
    expect(kinds).toEqual(['error']);
    expect(code).toBe(1);
  });

  it('names a file that is not there', async () => {
    const { text, kinds, code } = await run(johnEnv(), ['missing.txt']);

    expect(text).toBe('john: missing.txt: No such file or directory');
    expect(kinds).toEqual(['error']);
    expect(code).toBe(1);
  });

  it('names a directory handed to it in place of a file', async () => {
    const { text, code } = await run(johnEnv(), ['projects']);

    expect(text).toBe('john: projects: Is a directory');
    expect(code).toBe(1);
  });

  it('names a file this tier may not read', async () => {
    const env = johnEnv({ userType: 'guest', targetReadableBy: ['root', 'user'] });

    const { text, code } = await run(env, ['hashes.txt']);

    expect(text).toBe('john: hashes.txt: Permission denied');
    expect(code).toBe(1);
  });

  it('names the missing wordlist and how to get one', async () => {
    // Without a list there is nothing to try, and reporting "0 cracked" would
    // read as a strong password rather than a missing file.
    const env = johnEnv({ wordlist: null, target: passwdRow('deploy', 'letmein') });

    const { text, kinds, code } = await run(env, ['hashes.txt']);

    expect(text).toBe(
      'john: no wordlist at /usr/share/wordlists/passwords.txt — install one with: apt install hydra',
    );
    expect(kinds).toEqual(['error']);
    expect(code).toBe(1);
  });

  it('refuses before announcing any work', async () => {
    // Every refusal above is decided before the first line paints, so a player
    // never watches a crack start that was never going to run.
    const env = johnEnv({ wordlist: null });

    const result = await john.execute(env, ['hashes.txt'], new Map());

    expect(result.kind).toBe('sync');
  });
});

describe('john as the player watches it', () => {
  it('streams the run so it can be interrupted', async () => {
    const env = johnEnv({ wordlist: ['letmein'], target: passwdRow('deploy', 'letmein') });

    const result = await john.execute(env, ['hashes.txt'], new Map());

    expect(result.kind).toBe('async');
  });

  it('says how many words it loaded and how many hashes it is working', async () => {
    const env = johnEnv({
      wordlist: ['hunter2', 'letmein', 'trustno1'],
      target: [passwdRow('root', 'correct-horse-battery'), passwdRow('deploy', 'letmein')].join(
        '\n',
      ),
    });

    const { text } = await run(env, ['hashes.txt']);

    expect(text).toContain('Loaded 3 words into wordlist');
    expect(text).toContain('Cracking 2 password hashes...');
  });

  it('lays the whole run out in order, cracked accounts between two blank lines', async () => {
    // Asserted whole rather than by fragments: `toContain('1/2 …')` also passes
    // for '-1/2 …', so a miscount would read as correct.
    const env = johnEnv({
      wordlist: ['letmein', 'hunter2'],
      target: [passwdRow('root', 'correct-horse-battery'), passwdRow('deploy', 'letmein')].join(
        '\n',
      ),
    });

    const result = await john.execute(env, ['hashes.txt'], new Map());
    if (result.kind !== 'async') throw new Error('expected a streamed run');
    const lines: TerminalLine[] = [];
    for await (const line of result.lines) lines.push(line);

    expect(lines.map((line) => line.content)).toEqual([
      'Loaded 2 words into wordlist',
      'Cracking 2 password hashes...',
      '',
      'deploy:letmein',
      '',
      '1/2 password hashes cracked',
    ]);
  });

  it('speaks of a single hash in the singular', async () => {
    const env = johnEnv({ wordlist: ['letmein'], target: passwdRow('deploy', 'letmein') });

    const { text } = await run(env, ['hashes.txt']);

    expect(text).toContain('Cracking 1 password hash...');
    expect(text).toContain('1/1 password hash cracked');
  });

  it('is available on any machine, needing only its binary', () => {
    // Declared metadata, but the honest declaration: nothing in john restricts it
    // to the player's own workstation, unlike hydra.
    expect(john.availability).toEqual({ kind: 'any-machine' });
  });
});

/** The wordlist path is the shared one every credential tool reads, so a
 *  password appended by hand widens hydra and john together. */
it('reads the same wordlist file hydra does', async () => {
  const env = johnEnv({ wordlist: ['letmein'], target: passwdRow('deploy', 'letmein') });

  expect(env.fs.read(asAbsPath(WORDLIST_PATH)).ok).toBe(true);
});
