/**
 * gpg — symmetric encryption over a file, and the way back.
 *
 * Every other secret on a box is protected by one thing: a permission the
 * walker checks, which root passes before it reads a single array. This is the
 * only protection that survives being rooted — the ciphertext is what lands in
 * the machine's journal, so an intruder holding root reads base64, and so does
 * the server storing it. The passphrase never leaves the player.
 *
 * The codec is legacy's, so a file encrypted in one place opens in the other:
 * `base64( FNV-1a(plaintext)[4] XOR key[0..3] || XOR(plaintext, key) )`, keyed
 * by md5 of the passphrase. The four-byte checksum is what makes a wrong
 * passphrase a clean refusal rather than a screenful of garbage, and base64 is
 * what keeps the result storable in a TEXT column.
 */

import {
  PATCH_ERROR_REASON,
  type Command,
  type CommandEnv,
  type CommandResult,
  type FsReadResult,
  type TerminalLine,
} from './types';
import { dirname, resolveAbsPath } from '../filesystem/path';
import { asAbsPath } from '../types';
import { md5 } from '../generation/md5';
import { splitContentLines } from './contentHelpers';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const hexToBytes = (hex: string): Uint8Array =>
  Uint8Array.from({ length: hex.length / 2 }, (_unused, index) =>
    parseInt(hex.slice(index * 2, index * 2 + 2), 16),
  );

/** FNV-1a over the plaintext, as four bytes. The offset basis and the prime are
 *  the algorithm's own constants, not arbitrary values. */
const fnv1aBytes = (data: Uint8Array): Uint8Array => {
  const hash = data.reduce(
    (accumulator, byte) => Math.imul(accumulator ^ byte, 0x01000193),
    0x811c9dc5,
  );
  const unsigned = hash >>> 0;
  return Uint8Array.of(
    (unsigned >>> 24) & 0xff,
    (unsigned >>> 16) & 0xff,
    (unsigned >>> 8) & 0xff,
    unsigned & 0xff,
  );
};

const xorWithKey = (data: Uint8Array, key: Uint8Array): Uint8Array =>
  Uint8Array.from(data, (byte, index) => byte ^ (key[index % key.length] as number));

/** Base64 without spreading the array into `String.fromCharCode` — the spread
 *  form legacy used overflows the argument limit on a large file. */
const toBase64 = (bytes: Uint8Array): string =>
  btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));

const tryFromBase64 = (encoded: string): Uint8Array | null => {
  try {
    return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
};

/** The checksum as stored: FNV-1a of the plaintext, masked by the first four
 *  key bytes, so it says nothing about the plaintext to a reader without the
 *  passphrase. */
const maskedChecksum = (plaintext: Uint8Array, key: Uint8Array): Uint8Array => {
  const raw = fnv1aBytes(plaintext);
  return Uint8Array.from(raw, (byte, index) => byte ^ (key[index] as number));
};

const keyFrom = (passphrase: string): Uint8Array => hexToBytes(md5(passphrase));

const encryptContent = (plaintext: string, passphrase: string): string => {
  const key = keyFrom(passphrase);
  const data = encoder.encode(plaintext);
  const combined = new Uint8Array(4 + data.length);
  combined.set(maskedChecksum(data, key));
  combined.set(xorWithKey(data, key), 4);
  return toBase64(combined);
};

/** `null` for anything that does not decrypt: a wrong passphrase, a file that
 *  was never ciphertext, a truncated one. The caller says so in one voice — the
 *  three cases are indistinguishable by construction, which is the point. */
const decryptContent = (ciphertext: string, passphrase: string): string | null => {
  const key = keyFrom(passphrase);
  // `atob` THROWS on anything that is not base64, which is most files a player
  // will point this at by mistake. Caught here so the refusal is gpg's, not the
  // shell's report of an exception escaping a command.
  const encrypted = tryFromBase64(ciphertext);
  if (encrypted === null || encrypted.length < 4) return null;

  const plaintext = xorWithKey(encrypted.slice(4), key);
  const expected = maskedChecksum(plaintext, key);
  const stored = encrypted.slice(0, 4);
  if (!stored.every((byte, index) => byte === expected[index])) return null;

  return decoder.decode(plaintext);
};

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
      'Encrypt a file under a passphrase, or decrypt one back to the screen. "-c" writes the encrypted copy to <file>.gpg and leaves the original alone; it refuses if that name is already taken, so re-encrypting an edited file means removing the old one first. "-d" prints the decrypted content and writes nothing anywhere. Give the passphrase as the last argument, or leave it off and it is asked for at a masked prompt - which needs a terminal, so over a connection that has none the passphrase has to be on the line. A wrong passphrase is refused rather than printing nonsense: the encrypted file carries a checksum. This protects a file from anyone who reads the disk, root included, because what is stored is the encrypted form and the passphrase is never kept anywhere. Lose it and the content is gone.',
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
