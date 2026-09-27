import { describe, expect, it, vi } from 'vitest';
import { gpg } from './gpg';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { mockCommandEnv, mockFsViewFromTree, mockSession } from '../../test/factories/commandEnv';
import { applyPatches, type Patch } from '../filesystem/applyPatches';
import { createFsView } from '../filesystem/fsView';
import { asAbsPath, type UserType } from '../types';
import type { CommandEnv, CommandResult, PatchApi, PatchResult } from './types';
import type { Directory } from '../filesystem/types';

const ENCRYPT = new Map<string, string | true>([['-c', true]]);
const DECRYPT = new Map<string, string | true>([['-d', true]]);

const linesOf = (result: CommandResult, kind: 'text' | 'error'): string[] =>
  result.kind === 'sync'
    ? result.lines.filter((line) => line.kind === kind).map((line) => line.content)
    : [];

const textLines = (result: CommandResult): string[] => linesOf(result, 'text');
const errorLines = (result: CommandResult): string[] => linesOf(result, 'error');

const exitCodeOf = (result: CommandResult): number | undefined =>
  result.kind === 'sync' ? result.exitCode : undefined;

/** A box with one file in the player's own home, in a directory their tier may
 *  write — the ordinary case, and the one the encrypt half is for. */
const boxWithNotes = (content: string): Directory =>
  buildDirectory({
    home: buildDirectory({
      alice: buildDirectory(
        {
          'notes.txt': buildFile(content, { owner: 'alice' }),
        },
        { owner: 'alice' },
      ),
    }),
  });

const gpgEnv = (
  options: {
    readonly tree?: Directory;
    readonly userType?: UserType;
    readonly username?: string;
    readonly cwd?: string;
    readonly reloadTo?: Directory;
    readonly answer?: string | Error;
    readonly writeResult?: PatchResult;
  } = {},
): {
  readonly env: CommandEnv;
  readonly writeFn: ReturnType<typeof vi.fn>;
  readonly promptFn: ReturnType<typeof vi.fn>;
} => {
  const writeFn = vi.fn<PatchApi['write']>(async () => options.writeResult ?? { ok: true });
  const answer = options.answer;
  const promptFn = vi.fn<CommandEnv['prompt']>(async () => {
    if (answer instanceof Error) throw answer;
    return answer ?? '';
  });
  const reloaded = options.reloadTo;
  const env = mockCommandEnv({
    fs: mockFsViewFromTree(options.tree ?? boxWithNotes('the plaintext\n'), {
      userType: options.userType ?? 'user',
      cwd: asAbsPath(options.cwd ?? '/home/alice'),
      ...(reloaded === undefined ? {} : { onReload: async () => reloaded }),
    }),
    session: mockSession({
      username: options.username ?? 'alice',
      userType: options.userType ?? 'user',
    }),
    patches: {
      write: writeFn,
      remove: async () => ({ ok: true }),
      mkdir: async () => ({ ok: true }),
      setDirectoryPermissions: async () => ({ ok: true }),
    },
    prompt: promptFn,
  });
  return { env, writeFn, promptFn };
};

/** Replay the patch the command actually sent, so the ciphertext under test is
 *  the one that reached the machine rather than a value the test computed for
 *  itself. Decrypting anything else would prove only that the codec is its own
 *  inverse. */
const treeAfterWrite = (
  tree: Directory,
  writeFn: ReturnType<typeof vi.fn>,
  owner = 'alice',
): Directory => {
  const [path, content, patchOptions] = writeFn.mock.calls[0] as Parameters<PatchApi['write']>;
  const patch: Patch = {
    path,
    content,
    owner: patchOptions?.owner ?? owner,
    ...(patchOptions?.permissions ? { permissions: patchOptions.permissions } : {}),
  };
  return applyPatches(tree, [patch]);
};

describe('gpg — a file nobody else can read', () => {
  // Multi-line and non-ASCII are here because a naive port of the codec breaks
  // on exactly them: the bytes go through UTF-8 and back out through base64, so
  // any step that treats a character as a byte loses the accent and the emoji.
  // Empty is here because the format is a 4-byte checksum plus nothing, which is
  // the shortest thing decrypt must still accept.
  const ROUND_TRIP_CASES: readonly (readonly [string, string])[] = [
    ['a single line', 'the passphrase is hunter2\n'],
    ['several lines', 'first\nsecond\n\nfourth\n'],
    ['non-ASCII text', 'café ☕ naïve — résumé\n'],
    ['an empty file', ''],
  ];

  it.each(ROUND_TRIP_CASES)('round-trips %s through -c and -d', async (_label, content) => {
    const tree = boxWithNotes(content);
    const { env, writeFn } = gpgEnv({ tree });

    const encrypted = await gpg.execute(env, ['notes.txt', 'hunter2'], ENCRYPT);
    expect(errorLines(encrypted)).toEqual([]);
    expect(exitCodeOf(encrypted)).toBe(0);

    const { env: readBack } = gpgEnv({ tree: treeAfterWrite(tree, writeFn) });
    const decrypted = await gpg.execute(readBack, ['notes.txt.gpg', 'hunter2'], DECRYPT);

    expect(errorLines(decrypted)).toEqual([]);
    expect(exitCodeOf(decrypted)).toBe(0);
    expect(textLines(decrypted).join('\n')).toBe(content.replace(/\n$/, ''));
  });

  it('leaves base64 on the box, with the plaintext nowhere in it', async () => {
    const tree = boxWithNotes('the passphrase is hunter2\n');
    const { env, writeFn } = gpgEnv({ tree });

    await gpg.execute(env, ['notes.txt', 'hunter2'], ENCRYPT);

    const stored = createFsView(treeAfterWrite(tree, writeFn), { userType: 'root' }).read(
      asAbsPath('/home/alice/notes.txt.gpg'),
    );
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    expect(stored.content).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    // The two things a reader must not find in the file: what it says, and how
    // to open it. Base64 of a passphrase-keyed XOR contains neither, but a
    // codec that fell back to storing the plaintext would still look encoded.
    expect(stored.content).not.toContain('hunter2');
    expect(stored.content).not.toContain('passphrase');
  });

  it('keeps the plaintext file exactly as it was', async () => {
    const tree = boxWithNotes('the plaintext\n');
    const { env, writeFn } = gpgEnv({ tree });

    await gpg.execute(env, ['notes.txt', 'hunter2'], ENCRYPT);

    // Encryption ADDS a file; it never removes or rewrites the one it read.
    // A player who typed `gpg -c` and lost their notes would have no way back.
    const after = createFsView(treeAfterWrite(tree, writeFn), { userType: 'root' });
    const original = after.read(asAbsPath('/home/alice/notes.txt'));
    expect(original.ok && original.content).toBe('the plaintext\n');
    expect(writeFn).toHaveBeenCalledTimes(1);
    expect(writeFn.mock.calls[0]?.[0]).toBe('/home/alice/notes.txt.gpg');
  });

  it('refuses a wrong passphrase cleanly, and prints no garbage', async () => {
    const tree = boxWithNotes('the plaintext\n');
    const { env, writeFn } = gpgEnv({ tree });
    await gpg.execute(env, ['notes.txt', 'hunter2'], ENCRYPT);

    const { env: readBack } = gpgEnv({ tree: treeAfterWrite(tree, writeFn) });
    const result = await gpg.execute(readBack, ['notes.txt.gpg', 'hunter3'], DECRYPT);

    expect(errorLines(result)).toEqual(['gpg: decryption failed: bad passphrase or corrupted data']);
    expect(exitCodeOf(result)).toBe(1);
    // The checksum earns its four bytes here: without it, a near-miss
    // passphrase would XOR out a screenful of mojibake and call it success.
    expect(textLines(result)).toEqual([]);
  });

  it('says the same thing about a file that was never ciphertext', async () => {
    const { env } = gpgEnv({ tree: boxWithNotes('just some notes, not base64 at all\n') });

    const result = await gpg.execute(env, ['notes.txt', 'hunter2'], DECRYPT);

    // Indistinguishable by design: a reader learns nothing about WHY it failed,
    // so a wrong guess cannot be told apart from the wrong file.
    expect(errorLines(result)).toEqual(['gpg: decryption failed: bad passphrase or corrupted data']);
    expect(exitCodeOf(result)).toBe(1);
  });

  it('writes nothing at all when decrypting', async () => {
    const tree = boxWithNotes('the plaintext\n');
    const { env, writeFn } = gpgEnv({ tree });
    await gpg.execute(env, ['notes.txt', 'hunter2'], ENCRYPT);

    const { env: readBack, writeFn: decryptWrites } = gpgEnv({
      tree: treeAfterWrite(tree, writeFn),
    });
    await gpg.execute(readBack, ['notes.txt.gpg', 'hunter2'], DECRYPT);

    // `-d` is a read. Real gpg would write the plaintext out with `-o`, which
    // this game does not have — the plaintext exists on screen and nowhere else.
    expect(decryptWrites).not.toHaveBeenCalled();
  });

  it('asks for the passphrase at a masked prompt when the line does not carry one', async () => {
    const tree = boxWithNotes('the plaintext\n');
    const { env, writeFn, promptFn } = gpgEnv({ tree, answer: 'typed-at-the-prompt' });

    await gpg.execute(env, ['notes.txt'], ENCRYPT);

    expect(promptFn).toHaveBeenCalledWith({ message: 'Enter passphrase: ', masked: true });

    // The prompted answer is the key, not decoration: the file only opens with
    // what was typed there.
    const { env: readBack } = gpgEnv({ tree: treeAfterWrite(tree, writeFn) });
    const opened = await gpg.execute(readBack, ['notes.txt.gpg', 'typed-at-the-prompt'], DECRYPT);
    expect(textLines(opened)).toEqual(['the plaintext']);
  });

  it('asks the same way when decrypting', async () => {
    const tree = boxWithNotes('the plaintext\n');
    const { env, writeFn } = gpgEnv({ tree });
    await gpg.execute(env, ['notes.txt', 'hunter2'], ENCRYPT);

    const { env: readBack, promptFn } = gpgEnv({
      tree: treeAfterWrite(tree, writeFn),
      answer: 'hunter2',
    });
    const result = await gpg.execute(readBack, ['notes.txt.gpg'], DECRYPT);

    expect(promptFn).toHaveBeenCalledWith({ message: 'Enter passphrase: ', masked: true });
    expect(textLines(result)).toEqual(['the plaintext']);
  });

  it('writes nothing and says nothing when the prompt is aborted', async () => {
    const { env, writeFn } = gpgEnv({ answer: new Error('aborted') });

    const result = await gpg.execute(env, ['notes.txt'], ENCRYPT);

    // Ctrl-C at a password prompt is 130 everywhere else in this shell, and an
    // abort must not leave a half-made file behind.
    expect(exitCodeOf(result)).toBe(130);
    expect(result.kind === 'sync' && result.lines).toEqual([]);
    expect(writeFn).not.toHaveBeenCalled();
  });

  it('refuses an empty passphrase rather than encrypting with nothing', async () => {
    const { env, writeFn } = gpgEnv({ answer: '' });

    const result = await gpg.execute(env, ['notes.txt'], ENCRYPT);

    // An empty answer is almost always a player pressing Enter to see what
    // happens. Encrypting with it would produce a file whose "passphrase" is
    // the empty string — openable by anyone who tries it first.
    expect(errorLines(result)).toEqual(['gpg: no passphrase given']);
    expect(exitCodeOf(result)).toBe(1);
    expect(writeFn).not.toHaveBeenCalled();
  });

  it('refuses to overwrite a .gpg that is already there', async () => {
    const tree = buildDirectory({
      home: buildDirectory({
        alice: buildDirectory(
          {
            'notes.txt': buildFile('rewritten since\n', { owner: 'alice' }),
            'notes.txt.gpg': buildFile('AAAAAAAAAAA=', { owner: 'alice' }),
          },
          { owner: 'alice' },
        ),
      }),
    });
    const { env, writeFn, promptFn } = gpgEnv({ tree });

    const result = await gpg.execute(env, ['notes.txt', 'hunter2'], ENCRYPT);

    // The file this would destroy is ciphertext: nothing on screen would say it
    // had gone, and a passphrase mismatch between the two would only surface
    // the next time somebody tried to open it. Real gpg refuses here too when
    // it cannot ask.
    expect(errorLines(result)).toEqual(['gpg: notes.txt.gpg: File exists']);
    expect(exitCodeOf(result)).toBe(1);
    expect(writeFn).not.toHaveBeenCalled();
    // And nobody was asked for a secret to protect a file that was never
    // going to be written.
    expect(promptFn).not.toHaveBeenCalled();
  });

  it('asks for one of the two halves when the line names neither', async () => {
    const { env, writeFn } = gpgEnv();

    const result = await gpg.execute(env, ['notes.txt', 'hunter2'], new Map());

    // Without a mode there is no safe default: guessing `-d` would fail on a
    // plaintext file, and guessing `-c` would silently create one.
    expect(errorLines(result)).toEqual([
      'gpg: choose -c to encrypt or -d to decrypt',
      'gpg: usage: gpg -c|-d <file> [passphrase]',
    ]);
    expect(exitCodeOf(result)).toBe(1);
    expect(writeFn).not.toHaveBeenCalled();
  });

  it('refuses both halves at once rather than picking one', async () => {
    const { env, writeFn } = gpgEnv();

    const result = await gpg.execute(
      env,
      ['notes.txt', 'hunter2'],
      new Map([
        ['-c', true],
        ['-d', true],
      ]),
    );

    expect(errorLines(result)).toEqual([
      'gpg: choose -c to encrypt or -d to decrypt',
      'gpg: usage: gpg -c|-d <file> [passphrase]',
    ]);
    expect(exitCodeOf(result)).toBe(1);
    expect(writeFn).not.toHaveBeenCalled();
  });

  it('names the missing operand instead of reaching for the current directory', async () => {
    const { env, promptFn } = gpgEnv();

    const result = await gpg.execute(env, [], ENCRYPT);

    // An empty path resolves to the cwd, so without this the player would be
    // told their own directory `Is a directory` — an answer about the wrong
    // thing entirely.
    expect(errorLines(result)).toEqual([
      'gpg: missing operand',
      'gpg: usage: gpg -c|-d <file> [passphrase]',
    ]);
    expect(exitCodeOf(result)).toBe(1);
    expect(promptFn).not.toHaveBeenCalled();
  });

  const UNREACHABLE_CASES: readonly (readonly [string, string, string])[] = [
    ['a file that is not there', 'absent.txt', "gpg: can't open 'absent.txt': No such file or directory"],
    ['a directory', '/home/alice', "gpg: can't open '/home/alice': Is a directory"],
    ['a file this tier may not read', '/etc/shadow', "gpg: can't open '/etc/shadow': Permission denied"],
  ];

  it.each(UNREACHABLE_CASES)('refuses %s, naming it as typed', async (_label, path, message) => {
    const tree = buildDirectory({
      etc: buildDirectory({
        shadow: buildFile('root:hash\n', {
          owner: 'root',
          perms: { read: ['root'], write: ['root'], execute: [] },
        }),
      }),
      home: buildDirectory({
        alice: buildDirectory({ 'notes.txt': buildFile('x\n', { owner: 'alice' }) }, { owner: 'alice' }),
      }),
    });

    for (const mode of [ENCRYPT, DECRYPT]) {
      const { env, writeFn, promptFn } = gpgEnv({ tree });

      const result = await gpg.execute(env, [path, 'hunter2'], mode);

      // The path the PLAYER wrote, not the resolved absolute one: a relative
      // argument answered with an absolute path reads as a different file.
      expect(errorLines(result)).toEqual([message]);
      expect(exitCodeOf(result)).toBe(1);
      expect(writeFn).not.toHaveBeenCalled();
      expect(promptFn).not.toHaveBeenCalled();
    }
  });

  it('refuses to encrypt into a directory this tier cannot write', async () => {
    const tree = buildDirectory({
      etc: buildDirectory(
        { 'motd.txt': buildFile('welcome\n', { owner: 'root', perms: { read: ['root', 'user', 'guest'] } }) },
        { owner: 'root' },
      ),
    });
    const { env, writeFn } = gpgEnv({ tree, cwd: '/etc' });

    const result = await gpg.execute(env, ['motd.txt', 'hunter2'], ENCRYPT);

    // Readable is not writable: a player can read /etc/motd.txt and still have
    // nowhere to put the .gpg beside it. Refusing here keeps a doomed write off
    // the wire, which on someone else's box would also announce the attempt.
    expect(errorLines(result)).toEqual(["gpg: can't create 'motd.txt.gpg': Permission denied"]);
    expect(exitCodeOf(result)).toBe(1);
    expect(writeFn).not.toHaveBeenCalled();
  });

  it('composes from the machine, not from what this tab last pulled', async () => {
    const stale = boxWithNotes('what this tab last saw\n');
    const current = boxWithNotes('what the machine actually holds\n');
    const { env, writeFn } = gpgEnv({ tree: stale, reloadTo: current });

    await gpg.execute(env, ['notes.txt', 'hunter2'], ENCRYPT);

    // A fellow occupant's edit between this tab's last read and the encrypt has
    // to be what gets encrypted — otherwise the .gpg preserves a version of the
    // file that no longer exists.
    const { env: readBack } = gpgEnv({ tree: treeAfterWrite(current, writeFn) });
    const opened = await gpg.execute(readBack, ['notes.txt.gpg', 'hunter2'], DECRYPT);
    expect(textLines(opened)).toEqual(['what the machine actually holds']);
  });

  it('marks the new file as new, and claims nothing about who owns it', async () => {
    const { env, writeFn } = gpgEnv();

    await gpg.execute(env, ['notes.txt', 'hunter2'], ENCRYPT);

    const [, , options] = writeFn.mock.calls[0] as Parameters<PatchApi['write']>;
    // `isNew` is what lets a later `rm` delete the row instead of leaving a
    // tombstone. Owner and permissions are deliberately absent: the ciphertext
    // belongs to whoever made it, at the default new-file shape, which is what
    // the patch layer stamps when a caller says nothing.
    expect(options?.isNew).toBe(true);
    expect(options?.owner).toBeUndefined();
    expect(options?.permissions).toBeUndefined();
  });

  it('reports a refused patch instead of exiting 0 on a write that never landed', async () => {
    const { env } = gpgEnv({ writeResult: { ok: false, error: 'permission_denied' } });

    const result = await gpg.execute(env, ['notes.txt', 'hunter2'], ENCRYPT);

    // Silence means success at this prompt. A refused patch reported as silence
    // would leave a player believing a file exists that does not.
    expect(errorLines(result)).toEqual(["gpg: can't create 'notes.txt.gpg': Permission denied"]);
    expect(exitCodeOf(result)).toBe(1);
  });

  it('says what a lost round trip was, rather than calling it a refusal', async () => {
    const { env } = gpgEnv({ writeResult: { ok: false, error: 'network_error' } });

    const result = await gpg.execute(env, ['notes.txt', 'hunter2'], ENCRYPT);

    expect(errorLines(result)).toEqual(["gpg: can't create 'notes.txt.gpg': I/O error"]);
    expect(exitCodeOf(result)).toBe(1);
  });

  it('produces the same ciphertext for the same passphrase, and a different one otherwise', async () => {
    const cipherFor = async (passphrase: string): Promise<string> => {
      const { env, writeFn } = gpgEnv({ tree: boxWithNotes('the plaintext\n') });
      await gpg.execute(env, ['notes.txt', passphrase], ENCRYPT);
      const [, content] = writeFn.mock.calls[0] as Parameters<PatchApi['write']>;
      return content;
    };

    const [first, again, other] = await Promise.all([
      cipherFor('hunter2'),
      cipherFor('hunter2'),
      cipherFor('hunter3'),
    ]);

    // No salt, deliberately: the format has to be reproducible for a future
    // dictionary attack against a captured .gpg to be possible at all, which is
    // the same stance the game takes on its md5 hashes. The cost is that two
    // identical files under one passphrase look identical on disk.
    expect(again).toBe(first);
    expect(other).not.toBe(first);
  });

  /** Produced by the LEGACY implementation (`src/utils/crypto.ts`) with the key
   *  md5('hunter2'), and pasted here as a constant on purpose. It is the only
   *  thing in the suite that fails if the wire format drifts: every other test
   *  encrypts and decrypts with the same code, so a change to the key schedule,
   *  the checksum or the byte order would round-trip perfectly and still lock
   *  every existing .gpg out of the game. */
  const LEGACY_VECTOR =
    'AMW/il7RBrCxupYv6ccuY/9uNw5ZmVeo9u7pIvODbXjzbjcDRdYRsK6owyzzxzlk/it7AkzNaQ==';

  const boxWithVector = (content: string): Directory =>
    buildDirectory({
      home: buildDirectory({
        alice: buildDirectory({ 'loot.gpg': buildFile(content, { owner: 'alice' }) }, { owner: 'alice' }),
      }),
    });

  it('opens a file the legacy codec produced', async () => {
    const { env } = gpgEnv({ tree: boxWithVector(LEGACY_VECTOR) });

    const result = await gpg.execute(env, ['loot.gpg', 'hunter2'], DECRYPT);

    expect(textLines(result)).toEqual(['the vault code is 4815', 'and the door is on the left']);
    expect(exitCodeOf(result)).toBe(0);
  });

  it('refuses a passphrase whose checksum collides in part', async () => {
    const { env } = gpgEnv({ tree: boxWithVector(LEGACY_VECTOR) });

    // 'wrong30' produces a checksum matching the stored one in exactly one of
    // its four bytes. A verifier asking whether ANY byte matches would open the
    // file here and hand back mojibake; all four have to agree.
    const result = await gpg.execute(env, ['loot.gpg', 'wrong30'], DECRYPT);

    expect(errorLines(result)).toEqual(['gpg: decryption failed: bad passphrase or corrupted data']);
    expect(exitCodeOf(result)).toBe(1);
  });

  it('refuses a file that was tampered with, even with the right passphrase', async () => {
    const flipped = `${LEGACY_VECTOR.slice(0, 20)}Z${LEGACY_VECTOR.slice(21)}`;
    const { env } = gpgEnv({ tree: boxWithVector(flipped) });

    // This is what the four checksum bytes are FOR: the XOR would decode
    // something for any input at all, so without them a corrupted file reads as
    // a successful decrypt of nonsense.
    const result = await gpg.execute(env, ['loot.gpg', 'hunter2'], DECRYPT);

    expect(errorLines(result)).toEqual(['gpg: decryption failed: bad passphrase or corrupted data']);
    expect(exitCodeOf(result)).toBe(1);
  });

  it('refuses a truncated file rather than reading a checksum that is not there', async () => {
    const { env } = gpgEnv({ tree: boxWithVector('AAA=') });

    const result = await gpg.execute(env, ['loot.gpg', 'hunter2'], DECRYPT);

    expect(errorLines(result)).toEqual(['gpg: decryption failed: bad passphrase or corrupted data']);
    expect(exitCodeOf(result)).toBe(1);
  });

  it('abandons a decrypt when its prompt is abandoned', async () => {
    const { env } = gpgEnv({
      tree: boxWithVector(LEGACY_VECTOR),
      answer: new Error('aborted'),
    });

    const result = await gpg.execute(env, ['loot.gpg'], DECRYPT);

    expect(exitCodeOf(result)).toBe(130);
    expect(result.kind === 'sync' && result.lines).toEqual([]);
  });

  it('refuses an empty passphrase at the decrypt prompt too', async () => {
    const { env } = gpgEnv({ tree: boxWithVector(LEGACY_VECTOR), answer: '' });

    const result = await gpg.execute(env, ['loot.gpg'], DECRYPT);

    // The same rule as encryption's, and for the same reason: an empty answer
    // is a player pressing Enter, not a passphrase.
    expect(errorLines(result)).toEqual(['gpg: no passphrase given']);
    expect(exitCodeOf(result)).toBe(1);
  });
});
