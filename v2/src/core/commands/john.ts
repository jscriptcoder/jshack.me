/**
 * john — recover passwords from hashes the player already holds.
 *
 * The SILENT half of the credential layer. `hydra` and `john` answer the same
 * question against the same wordlist with the same `md5`, so for any hash a
 * player can reach, the two return an identical set of plaintexts. The whole
 * difference is who finds out: a sweep writes one `auth.log` line per password
 * tried into the target's own log, and this writes nothing anywhere. That is why
 * it is worth having, and why it must never acquire a server call — the absence
 * of one IS the feature, not an implementation detail.
 *
 * Everything is read from the CURRENT machine: the file named on the command
 * line, and the wordlist behind it. A player's own box is somewhere they operate
 * FROM, not the only place the toolchain exists, so standing on a box they have
 * taken, john works there exactly as it does at home — needing only a wordlist on
 * that box. There is deliberately no "not your machine" refusal here, unlike
 * hydra.
 *
 * It ships no wordlist of its own and reads the shared
 * `/usr/share/wordlists/passwords.txt` that `apt install hydra` installs. One
 * list means one progression: a password harvested and appended by hand widens
 * both tools at once.
 *
 * Every refusal is decided BEFORE the first line paints, so a player never
 * watches a crack start that was never going to run, and each names its own
 * cause — "nothing found" and "nothing tried" must not look alike.
 */

import { resolveAbsPath } from '../filesystem/path';
import { md5 } from '../generation/md5';
import { WORDLIST_PATH, parseWordlist } from '../wordlist/defaultWordlist';
import { streamedResult, text } from './streaming';
import type { Command, CommandEnv, CommandResult, FsReadResult, TerminalLine } from './types';

type FsReadError = Extract<FsReadResult, { readonly ok: false }>['error'];

/** A row worth attacking: an account and the hash sitting inline beside it. */
type HashRow = {
  readonly username: string;
  readonly hash: string;
};

/** Beat between john's steps, matching hydra's pacing so the two tools feel like
 *  the same toolchain. */
const STEP_DELAY_MS = 220;

/** Second fields that are not hashes at all. A shadowed, locked or passwordless
 *  account has nothing to crack, so counting one would understate how the
 *  player's wordlist is doing and invent work they cannot act on. */
const PLACEHOLDER_HASHES: ReadonlySet<string> = new Set(['x', '*', '!!', '']);

const errorResult = (content: string): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content }],
  exitCode: 1,
});

/** Legacy's wording, kept verbatim: these are the messages a player already
 *  knows from every other file-reading tool. */
const readErrorMessage = (target: string, error: FsReadError): string => {
  switch (error) {
    case 'not_found':
      return `john: ${target}: No such file or directory`;
    case 'is_directory':
      return `john: ${target}: Is a directory`;
    case 'permission_denied':
      return `john: ${target}: Permission denied`;
  }
};

/** The attackable rows of a passwd-format file. Comments and blank lines are not
 *  accounts, and a line carrying no second field is not a passwd row at all —
 *  none of them are hashes that resisted the wordlist, so none of them belong in
 *  the count the player reads.
 *
 *  One guard decides all of it. Filtering blank lines up front reads like it
 *  helps, but a blank line has no `:` and so falls to the missing-hash check
 *  anyway — a second rule that can never be the one that fires. A comment is the
 *  real exception: `# harvested from 10.0.0.4:22` splits exactly like a passwd
 *  row, so the leading `#` is the only thing telling them apart. */
const hashRowsIn = (content: string): readonly HashRow[] =>
  content.split('\n').flatMap((line) => {
    if (line.startsWith('#')) return [];
    const [username, hash] = line.split(':');
    if (hash === undefined) return [];
    return PLACEHOLDER_HASHES.has(hash) ? [] : [{ username, hash }];
  });

/** The first word whose hash matches, or undefined when the list does not hold
 *  this password. Membership in the list is the entire gate — a password absent
 *  from it never falls, however weak it looks. */
const passwordFor = (row: HashRow, words: readonly string[]): string | undefined =>
  words.find((word) => md5(word) === row.hash);

const pluralized = (count: number): string => (count === 1 ? 'hash' : 'hashes');

async function* crack(
  env: CommandEnv,
  rows: readonly HashRow[],
  words: readonly string[],
): AsyncGenerator<TerminalLine, number> {
  yield text(`Loaded ${words.length} words into wordlist`);
  await env.sleep(STEP_DELAY_MS);
  yield text(`Cracking ${rows.length} password ${pluralized(rows.length)}...`);
  yield text('');

  let cracked = 0;
  for (const row of rows) {
    await env.sleep(STEP_DELAY_MS);
    const password = passwordFor(row, words);
    if (password !== undefined) {
      cracked += 1;
      yield text(`${row.username}:${password}`);
    }
  }

  yield text('');
  yield text(`${cracked}/${rows.length} password ${pluralized(rows.length)} cracked`);
  return 0;
}

const execute: Command['execute'] = async (env, args) => {
  const [target] = args;
  if (target === undefined) {
    return errorResult('john: missing file operand — usage: john <file>');
  }

  const file = env.fs.read(resolveAbsPath(env.fs.cwd(), target));
  if (!file.ok) {
    return errorResult(readErrorMessage(target, file.error));
  }

  const rows = hashRowsIn(file.content);
  if (rows.length === 0) {
    return errorResult(`john: ${target}: No password hashes found`);
  }

  // Without a list there is nothing to try, and reporting "0 cracked" would read
  // as a file full of strong passwords rather than as a missing wordlist.
  const wordlist = env.fs.read(WORDLIST_PATH);
  if (!wordlist.ok) {
    return errorResult(
      `john: no wordlist at ${WORDLIST_PATH} — install one with: apt install hydra`,
    );
  }

  return streamedResult(crack(env, rows, parseWordlist(wordlist.content)));
};

export const john: Command = {
  name: 'john',
  description: 'Crack password hashes from a file using a dictionary attack',
  category: 'filesystem',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'john <file>',
    description:
      'Crack password hashes from a passwd-format file using a dictionary attack. Reads ' +
      'username:hash rows and tries every password in the wordlist ' +
      '(/usr/share/wordlists/passwords.txt) against each one. Unlike hydra it never contacts ' +
      'the machine the hashes came from, so the attempt leaves no trace in anyone’s logs. ' +
      'A password that is not in your wordlist will never be found, however weak it is — grow ' +
      'the list by editing it with nano as you harvest passwords elsewhere. Named after John ' +
      'the Ripper, the classic password cracking tool.',
    arguments: [
      {
        name: 'file',
        description: 'A passwd-format file holding username:hash rows',
        required: true,
      },
    ],
    examples: [
      { command: 'john /etc/passwd', description: 'Crack the hashes on this machine' },
      {
        command: 'john hashes.txt',
        description: 'Crack hashes copied off a machine you have taken',
      },
    ],
  },
  execute,
};
