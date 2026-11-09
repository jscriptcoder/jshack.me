/**
 * gpg — symmetric encryption over a file, and the way back.
 *
 * Every other secret on a box is protected by one thing: a permission the
 * walker checks, which root passes before it reads a single array. This is the
 * only protection that survives being rooted — the ciphertext is what lands in
 * the machine's journal, so an intruder holding root reads base64, and so does
 * the server storing it. The passphrase never leaves the player.
 *
 * The cipher is legacy's and lives in `core/crypto/gpgCodec.ts`, where the
 * server also seals a contract's key, so a file it seals opens with this command.
 */

import {
  PATCH_ERROR_REASON,
  type Command,
  type CommandEnv,
  type CommandResult,
  type FsReadResult,
  type TerminalLine,
} from './types.js';
import { dirname, resolveAbsPath } from '../filesystem/path.js';
import { asAbsPath } from '../types.js';
import { decryptContent, encryptContent } from '../crypto/gpgCodec.js';
import { splitContentLines } from './contentHelpers.js';

type FsReadError = Extract<FsReadResult, { readonly ok: false }>['error'];

const READ_FAILURE: Readonly<Record<FsReadError, string>> = {
  not_found: 'No such file or directory',
  is_directory: 'Is a directory',
  permission_denied: 'Permission denied',
};

/** Named as the player typed it, never as it resolved: a relative argument
 *  answered with an absolute path reads as an answer about a different file.
 *  Shared by both halves so the two can never drift into two vocabularies for
 *  the same failure. */
const cannotOpen = (pathArg: string, error: FsReadError): string =>
  `gpg: can't open '${pathArg}': ${READ_FAILURE[error]}`;

const USAGE = 'gpg: usage: gpg -c|-d <file> [passphrase]';

const refusal = (...messages: readonly string[]): CommandResult => ({
  kind: 'sync',
  lines: messages.map((content) => ({ kind: 'error', content })),
  exitCode: 1,
});

/** What the terminal shows when a player abandons a password prompt — the same
 *  silent 130 `su` answers a Ctrl-C with. */
const ABORTED: CommandResult = { kind: 'sync', lines: [], exitCode: 130 };

type Passphrase =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly result: CommandResult };

/** The passphrase from the command line, or from the player. Asked for AFTER
 *  the file has been resolved, so nobody types a secret for a file that was
 *  never going to open.
 *
 *  An empty one is refused from either source. Left to stand, it would encrypt
 *  under the key everybody guesses first, and the player who pressed Enter to
 *  see what happened would have no way of knowing. */
const passphraseFrom = async (env: CommandEnv, given: string | undefined): Promise<Passphrase> => {
  const typed = await (async () => {
    if (given !== undefined) return given;
    try {
      return await env.prompt({ message: 'Enter passphrase: ', masked: true });
    } catch {
      return null;
    }
  })();

  if (typed === null) return { ok: false, result: ABORTED };
  if (typed === '') return { ok: false, result: refusal('gpg: no passphrase given') };
  return { ok: true, value: typed };
};

const encrypt = async (
  env: CommandEnv,
  pathArg: string,
  given: string | undefined,
): Promise<CommandResult> => {
  // Re-read the box before composing. `env.fs` is what this client last pulled,
  // which is right for reading and wrong for a writer: on a machine a fellow
  // occupant can also write, both the content this encrypts and the answer to
  // "is there already a .gpg here" have to be the machine's, not this tab's.
  const fs = await env.fs.reload();
  const targetPath = resolveAbsPath(fs.cwd(), pathArg);
  const source = fs.read(targetPath);
  if (!source.ok) return refusal(cannotOpen(pathArg, source.error));

  // Encryption ADDS a file, so an existing one is somebody's ciphertext and
  // there is no undo: overwritten under a different passphrase, it would look
  // untouched and open for nobody. Checked against the machine's own tree, not
  // this tab's, and before the prompt.
  const outputPath = asAbsPath(`${targetPath}.gpg`);
  if (fs.stat(outputPath) !== null) {
    return refusal(`gpg: ${pathArg}.gpg: File exists`);
  }

  // Readable is not writable: a file can be open to this tier in a directory
  // that is not. Asked here so a doomed write never leaves the client — on
  // somebody else's box, a write that travelled and came back refused has
  // already announced the attempt.
  if (!fs.canWrite(dirname(outputPath)).allowed) {
    return refusal(`gpg: can't create '${pathArg}.gpg': Permission denied`);
  }

  const passphrase = await passphraseFrom(env, given);
  if (!passphrase.ok) return passphrase.result;

  const written = await env.patches.write(
    outputPath,
    encryptContent(source.content, passphrase.value),
    { isNew: true },
  );
  if (!written.ok) {
    // Silence is success at this prompt, so a refused patch reported as silence
    // would leave a player believing in a file that is not there.
    return refusal(`gpg: can't create '${pathArg}.gpg': ${PATCH_ERROR_REASON[written.error]}`);
  }

  return { kind: 'sync', lines: [], exitCode: 0 };
};

const decrypt = async (
  env: CommandEnv,
  pathArg: string,
  given: string | undefined,
): Promise<CommandResult> => {
  const source = env.fs.read(resolveAbsPath(env.fs.cwd(), pathArg));
  if (!source.ok) return refusal(cannotOpen(pathArg, source.error));

  const passphrase = await passphraseFrom(env, given);
  if (!passphrase.ok) return passphrase.result;

  const plaintext = decryptContent(source.content, passphrase.value);
  if (plaintext === null) {
    return refusal('gpg: decryption failed: bad passphrase or corrupted data');
  }

  const lines: readonly TerminalLine[] = splitContentLines(plaintext).map((content) => ({
    kind: 'text',
    content,
  }));
  return { kind: 'sync', lines, exitCode: 0 };
};

const execute = async (
  env: CommandEnv,
  args: readonly string[],
  flags: ReadonlyMap<string, string | true>,
): Promise<CommandResult> => {
  // Two flags naming two different operations, so one of them is required and
  // both together mean nothing. Neither has a safe default: guessing `-d` fails
  // on a plaintext file, and guessing `-c` silently creates one.
  const encrypting = flags.has('-c');
  if (encrypting === flags.has('-d')) {
    return refusal('gpg: choose -c to encrypt or -d to decrypt', USAGE);
  }

  const [pathArg, given] = args;
  if (pathArg === undefined) {
    // An empty path resolves to the current directory, so left to fall through
    // the player would be told their own cwd `Is a directory`.
    return refusal('gpg: missing operand', USAGE);
  }

  return encrypting ? encrypt(env, pathArg, given) : decrypt(env, pathArg, given);
};

export const gpg: Command = {
  name: 'gpg',
  description: 'Encrypt and decrypt files with a passphrase',
  category: 'filesystem',
  tier: 'guest',
  availability: { kind: 'installed-package', packageName: 'gpg' },
  // The need for a terminal belongs to the FORM, not the command: with the
  // passphrase on the line there is nobody to ask, and reading an encrypted
  // file off a box you reached through a planted listener is what that vantage
  // is for. Only the form that would open a masked prompt is refused.
  withoutTty: (args) =>
    args[1] === undefined ? 'gpg: cannot open tty: pass the passphrase as an argument' : undefined,
  flags: { '-c': 'boolean', '-d': 'boolean' },
  manual: {
    synopsis: 'gpg -c|-d <file> [passphrase]',
    description:
      'Encrypt a file under a passphrase, or decrypt one back to the screen. "-c" writes the encrypted copy to <file>.gpg and leaves the original alone - so the unencrypted file is still sitting there, and hiding something means removing it yourself; it refuses if that name is already taken, so re-encrypting an edited file means removing the old one first. "-d" prints the decrypted content and writes nothing anywhere. Give the passphrase as the last argument, or leave it off and it is asked for at a masked prompt - which needs a terminal, so over a connection that has none the passphrase has to be on the line. A wrong passphrase is refused rather than printing nonsense: the encrypted file carries a checksum. This protects a file from anyone who reads the disk, root included, because what is stored is the encrypted form and the passphrase is never kept anywhere. Lose it and the content is gone.',
    arguments: [
      { name: 'file', description: 'The file to encrypt or decrypt', required: true },
      {
        name: 'passphrase',
        description: 'The passphrase; asked for at a masked prompt when it is left off',
        required: false,
      },
    ],
    examples: [
      {
        command: 'gpg -c notes.txt',
        description: 'Encrypt notes.txt to notes.txt.gpg, asking for the passphrase',
      },
      {
        command: 'gpg -d notes.txt.gpg',
        description: 'Print what notes.txt.gpg says',
      },
      {
        command: 'gpg -c secrets.txt hunter2',
        description: 'Encrypt without a prompt, so a script or a pipeline can do it',
      },
      {
        command: 'gpg -d loot.gpg hunter2 | grep password',
        description: 'Search inside an encrypted file without leaving a decrypted copy',
      },
    ],
  },
  execute,
};
