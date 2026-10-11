/**
 * wallet — a key file on the box, and the address it answers to.
 *
 * The key is the wallet: the ledger knows addresses and nothing about players,
 * so whoever holds the file's text spends the coins at its address. That makes
 * the file something to hide, and something a visitor with the tier can copy.
 */

import {
  PATCH_ERROR_REASON,
  type Command,
  type CommandEnv,
  type CommandResult,
  type PatchResult,
} from './types.js';
import { homeDirectory } from '../sessions/homeDirectory.js';
import { asAbsPath, type AbsPath, type UserType } from '../types.js';
import { formatWalletFile, generateWalletKey } from '../wallet/walletKey.js';

const USAGE = 'wallet: usage: wallet init';

const refusal = (message: string): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content: message }],
  exitCode: 1,
});

/** Who a wallet opens for: the account that made it, and root. */
const reachOf = (userType: UserType): readonly UserType[] => [
  ...new Set(['root', userType] as const),
];

/** Why the key cannot go where it belongs, or `null` when it can. Everything
 *  here is answered from the tree, so a doomed `init` asks the box for nothing
 *  and leaves no half-made directory behind. */
const obstacleTo = (
  fs: CommandEnv['fs'],
  home: AbsPath,
  walletDirectory: AbsPath,
  walletPath: AbsPath,
): string | null => {
  if (fs.stat(home) === null) return 'No such file or directory';
  const inTheWay = fs.stat(walletDirectory);
  if (inTheWay === null) {
    return fs.canWrite(walletDirectory).allowed ? null : 'Permission denied';
  }
  if (inTheWay.kind !== 'directory') return 'Not a directory';
  return fs.canWrite(walletPath).allowed ? null : 'Permission denied';
};

const init = async (env: CommandEnv): Promise<CommandResult> => {
  const home = homeDirectory(env.session);
  const walletDirectory = asAbsPath(`${home}/.wallet`);
  const walletPath = asAbsPath(`${walletDirectory}/wallet.dat`);
  const cannotCreate = (reason: string): CommandResult =>
    refusal(`wallet: can't create '${walletPath}': ${reason}`);

  // Asked of the machine rather than of what this terminal last pulled: a
  // wallet made a moment ago in another terminal is one this would replace,
  // and a replaced key takes every coin at its address with it.
  const fs = await env.fs.reload();
  if (fs.stat(walletPath) !== null) {
    return refusal(`wallet: a wallet already exists at ${walletPath}`);
  }

  const obstacle = obstacleTo(fs, home, walletDirectory, walletPath);
  if (obstacle !== null) return cannotCreate(obstacle);

  // A made directory opens to every tier, which is right for most and wrong for
  // the one that holds a key, so it is narrowed before the key goes into it. One
  // that is already there is narrowed too, and never made again: telling the box
  // an existing directory is new changes how the box forgets it.
  const reach = reachOf(env.session.userType);
  const key = generateWalletKey();
  const steps: readonly (() => Promise<PatchResult>)[] = [
    ...(fs.stat(walletDirectory) === null ? [() => env.patches.mkdir(walletDirectory)] : []),
    () =>
      env.patches.setDirectoryPermissions(
        walletDirectory,
        { read: reach, write: reach, execute: reach },
        { owner: env.session.username },
      ),
    () =>
      env.patches.write(walletPath, formatWalletFile(key), {
        isNew: true,
        permissions: { read: reach, write: reach, execute: [] },
      }),
  ];

  // In order, and stopping at the first one the box turns down: a key must
  // never land in a directory that was not closed first.
  for (const step of steps) {
    const done = await step();
    if (!done.ok) return cannotCreate(PATCH_ERROR_REASON[done.error]);
  }

  // The whole of what `init` says. An address on screen is a promise that its
  // key is on disk, which is why this comes after the write and not before.
  return {
    kind: 'sync',
    lines: [
      { kind: 'text', content: `address: ${key.address}` },
      { kind: 'text', content: `wallet: ${walletPath}` },
    ],
    exitCode: 0,
  };
};

const execute = async (env: CommandEnv, args: readonly string[]): Promise<CommandResult> =>
  args[0] === 'init' ? init(env) : refusal(USAGE);

export const wallet: Command = {
  name: 'wallet',
  description: 'Hold and send JSC',
  category: 'network',
  tier: 'guest',
  availability: { kind: 'installed-package', packageName: 'wallet' },
  manual: {
    synopsis: 'wallet init',
    description:
      'Keep JSC, the coin of this world. "init" makes a new wallet: a key, and the address that key answers to. It writes both to .wallet/wallet.dat in the home directory of the account running it, as two lines marked "address:" and "key:", then prints the address and the path of the file. The address is what you give to whoever is paying you. The key is the wallet - the coins at an address belong to whoever holds its key and nothing else is asked, so the file is the money. It opens for the account that made it and for root. Each account on a box has a wallet of its own, and "init" refuses when one is already in place: it never replaces a key. Making a wallet needs no network.',
    arguments: [
      {
        name: 'command',
        description: '"init", to make a new wallet for this account',
        required: true,
        values: ['init'],
      },
    ],
    examples: [
      {
        command: 'wallet init',
        description: 'Make a wallet, and print its address and where its key was written',
      },
      {
        command: 'cat /home/alice/.wallet/wallet.dat',
        description: 'Read the address and the key back off the file',
      },
    ],
  },
  execute,
};
