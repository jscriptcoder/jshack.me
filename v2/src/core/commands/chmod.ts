/**
 * chmod — change what a file permits, tier by tier.
 *
 * Permissions in this game are allowlists over the three tiers rather than nine
 * bits, so the mode is symbolic (`[ugoa][+-][rwx]`) and there is no octal form:
 * a number would have to say what `6` means for a tier the walker exempts.
 *
 * The change travels as an ordinary patch, so it lands in the machine's journal
 * and every later reader of that box sees it: for a file, the same content plus
 * the new permissions; for a directory, which has no content, the permissions
 * alone.
 */

import type { UserType } from '../types';
import type { FilePermissions } from '../filesystem/types';
import type { Command, CommandEnv, CommandResult } from './types';
import { resolveAbsPath } from '../filesystem/path';
import { accountIn } from '../sessions/passwdAccount';

const ALL_TIERS: readonly UserType[] = ['root', 'user', 'guest'];

const WHO_TIERS: Readonly<Record<string, readonly UserType[]>> = {
  g: ['user'],
  o: ['guest'],
  a: ALL_TIERS,
};

const PERM_KEYS: Readonly<Record<string, keyof FilePermissions>> = {
  r: 'read',
  w: 'write',
  x: 'execute',
};

type Mode = {
  readonly whoChars: string;
  readonly op: '+' | '-';
  readonly keys: readonly (keyof FilePermissions)[];
};

const MODE_SYNTAX = /^([ugoa]*)([+-])([rwx]+)$/;

const parseMode = (mode: string): Mode | null => {
  const match = MODE_SYNTAX.exec(mode);
  if (match === null) return null;

  const [, whoChars = '', op = '+', permChars = ''] = match;
  // The undefined arm is unreachable and required by the type: the pattern only
  // admits `[rwx]`, every one of which is a key here, but an index signature is
  // optional as far as the compiler is concerned. Same for the operator below,
  // which the pattern has already narrowed to one of two characters.
  const keys = [...permChars].flatMap((perm) => {
    const key = PERM_KEYS[perm];
    return key === undefined ? [] : [key];
  });

  return { whoChars, op: op === '-' ? '-' : '+', keys };
};

/** Which tiers a who-string names. `u` is the tier of the account that OWNS the
 *  node, read out of `/etc/passwd` by the same rule `su` and both ssh auth gates
 *  use — so `u` says something different on a root-owned file than on the box
 *  user's, and an owner holding no account row here (a service account like
 *  `mysql`, which owns files on every generated box and is nobody on any of
 *  them) is an other like any outsider. */
const tiersNamed = (whoChars: string, ownerTier: UserType): readonly UserType[] =>
  whoChars === ''
    ? ALL_TIERS
    : [
        ...new Set(
          [...whoChars].flatMap((who) => (who === 'u' ? [ownerTier] : (WHO_TIERS[who] ?? []))),
        ),
      ];

/** Root is never removed. The walker answers ALLOWED for root before it reads a
 *  single array, so clearing the bit would take nothing away — it would only
 *  make `ls -l` claim root is shut out of a file it goes on reading. Everyone
 *  else the removal names is taken away, or a chmod could not lock anything. */
const updatedTiers = (
  current: readonly UserType[],
  targets: readonly UserType[],
  op: '+' | '-',
): readonly UserType[] =>
  op === '+'
    ? [...current, ...targets.filter((tier) => !current.includes(tier))]
    : current.filter((tier) => tier === 'root' || !targets.includes(tier));

const applyMode = (
  current: FilePermissions,
  mode: Mode,
  targets: readonly UserType[],
): FilePermissions =>
  mode.keys.reduce<FilePermissions>(
    (perms, key) => ({ ...perms, [key]: updatedTiers(perms[key], targets, mode.op) }),
    current,
  );

const USAGE = 'chmod: usage: chmod <mode> <path>';

const refusal = (...messages: readonly string[]): CommandResult => ({
  kind: 'sync',
  lines: messages.map((content) => ({ kind: 'error', content })),
  exitCode: 1,
});

const execute = async (
  env: CommandEnv,
  args: readonly string[],
  flags: ReadonlyMap<string, string | true>,
): Promise<CommandResult> => {
  // Refused rather than ignored. Under this permission model a recursive chmod
  // is a whole-file rewrite per descendant — a patch storm where every row
  // carries the clobber hazard one chmod avoids by naming its base. The tool
  // for bulk work already shipped: a loop in a node script, one file at a time.
  if (flags.has('-R') || flags.has('-r')) {
    return refusal('chmod: -R is not supported; loop over the paths in a node script instead');
  }

  const [modeArg, pathArg] = args;
  if (modeArg === undefined) {
    return refusal('chmod: missing operand', USAGE);
  }
  if (pathArg === undefined) {
    // Named, because a player who typed a mode and stopped is one token from
    // done and should not have to re-read the synopsis to see which one.
    return refusal(`chmod: missing operand after '${modeArg}'`, USAGE);
  }

  const mode = parseMode(modeArg);
  if (mode === null) {
    return refusal(`chmod: invalid mode: '${modeArg}'`);
  }

  // Re-read the box before composing anything. `env.fs` is what this client
  // last pulled, which is right for a whole shell's worth of reading and wrong
  // for a writer: on a machine a fellow occupant can also write, a whole-file
  // write built from the stale copy reverts their edit rather than missing it.
  const fs = await env.fs.reload();

  const targetPath = resolveAbsPath(fs.cwd(), pathArg);
  const node = fs.stat(targetPath);
  if (node === null) {
    return refusal(`chmod: cannot access '${pathArg}': No such file or directory`);
  }

  // Whoever may WRITE the node may change what it permits, which is the same
  // question `nano`, `rm` and `touch` already ask. Refusing here rather than
  // letting the server refuse keeps a probe off another player's box: a write
  // that travelled and came back denied has still announced itself.
  if (!fs.canWrite(targetPath).allowed) {
    return refusal(`chmod: changing permissions of '${pathArg}': Operation not permitted`);
  }

  const ownerTier = accountIn(fs.root(), node.owner)?.userType ?? 'guest';
  const permissions = applyMode(node.perms, mode, tiersNamed(mode.whoChars, ownerTier));

  // A directory has no content to carry, so its change is exact and needs
  // neither the read below nor the base that guards it.
  if (node.kind === 'directory') {
    await env.patches.setDirectoryPermissions(targetPath, permissions, { owner: node.owner });
    return { kind: 'sync', lines: [], exitCode: 0 };
  }

  // A file's change is a whole-file write carrying the same content, so a caller
  // who cannot see the content cannot compose one — and guessing at it would
  // destroy the file while claiming to adjust one bit. Root reads everything and
  // a player's own file is readable, so this bites only a caller who could never
  // have opened the file in the first place.
  const content = fs.read(targetPath);
  if (!content.ok) {
    return refusal(`chmod: cannot access '${pathArg}': Permission denied`);
  }

  await env.patches.write(targetPath, content.content, {
    permissions,
    // The file still belongs to whoever owned it. Left to default, the patch
    // layer stamps the session's own username, so root adjusting one bit on
    // someone's file would quietly take it.
    owner: node.owner,
    // Naming the base makes the write conditional: a fellow occupant's edit
    // between the read and the send refuses the patch instead of being reverted
    // by a whole-file write that was only ever meant to move a permission.
    baseContent: content.content,
  });

  return { kind: 'sync', lines: [], exitCode: 0 };
};

export const chmod: Command = {
  name: 'chmod',
  description: 'Change file permissions',
  category: 'filesystem',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  // Declared so the command can refuse them in its own words. Undeclared, the
  // shell would answer `unrecognized option`, which reads as a typo rather than
  // as a capability this box deliberately does not have.
  flags: { '-R': 'boolean', '-r': 'boolean' },
  manual: {
    synopsis: 'chmod <mode> <path>',
    description:
      'Change what a file or directory permits, tier by tier. The mode is symbolic - [ugoa][+-][rwx] - because permissions here are allowlists over the three tiers rather than nine bits, so there is no octal form. The who letters line up with the three groups ls -l prints: u is the tier of the account that OWNS the node (an owner with no account on this box counts as an other), g is the user tier, o is the guest tier, and a - or no letter at all - is all three. A removal never takes the root tier away, since root passes every check regardless and the listing would only be telling you otherwise. Changing permissions needs write permission on the node, and a file you cannot read is refused: the change is written as the file plus its new permissions, so it cannot be composed blind. There is no -R; loop over the paths in a node script instead.',
    arguments: [
      {
        name: 'mode',
        description:
          'Symbolic mode: who ([ugoa], default a), then + or -, then one or more of rwx',
        required: true,
      },
      {
        name: 'path',
        description: 'The file or directory to change',
        required: true,
      },
    ],
    examples: [
      {
        command: 'chmod o+r /etc/shadow',
        description: 'Open a root-only file to the guest tier',
      },
      {
        command: 'chmod go-rwx notes.txt',
        description: 'Lock a file down to its owner and root',
      },
      {
        command: 'chmod o+rx /root',
        description: 'Let every tier list and enter a directory',
      },
      {
        command: 'chmod o-x /bin/ls',
        description: 'Stop the guest tier running a binary at all',
      },
    ],
  },
  execute,
};
