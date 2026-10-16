/**
 * wallet — a key file on the box, and the address it answers to.
 *
 * The key is the wallet: the ledger knows addresses and nothing about players,
 * so whoever holds the file's text spends the coins at its address. That makes
 * the file something to hide, and something a visitor with the tier can copy.
 *
 * What an address holds is the ledger's to say, and it says it to anyone: a
 * balance is read by address, with no key and nothing of the player's sent.
 * What an address has sent and received is read the same way, so the holder of
 * an emptied wallet can see where the coins went, as an address and never as a
 * name.
 *
 * Sending is the one thing the key is for. A transfer is signed by the key in
 * the file and by nothing else, so it says which address is spending and never
 * which player, and it touches no machine: no box gains a log line for it.
 * The key in place is the only one it reads: a key lying anywhere else is
 * spent by putting it there.
 */

import {
  PATCH_ERROR_REASON,
  type Command,
  type CommandEnv,
  type CommandResult,
  type PatchResult,
} from './types.js';
import { vantageOf } from '../network/vantage.js';
import { homeDirectory } from '../sessions/homeDirectory.js';
import { asAbsPath, type AbsPath, type UserType } from '../types.js';
import { readAmount } from '../wallet/amount.js';
import { historyLine } from '../wallet/historyLine.js';
import {
  formatWalletFile,
  generateWalletKey,
  isAddress,
  readWalletFile,
  type WalletKey,
} from '../wallet/walletKey.js';

const SYNOPSIS = 'wallet init | balance [address] | history [address] | send <address> <amount>';
const USAGE = `wallet: usage: ${SYNOPSIS}`;

/** The ledger is out on the internet, so asking it takes a network to ask from:
 *  the one the shell's box stands on. Making a key asks nobody. */
const UNREACHABLE = 'wallet: network is unreachable — connect to a network first';

/** Every way of getting nothing back from the ledger. After a transfer it does
 *  not say whether the coins moved, because the command cannot know. */
const NO_ANSWER = 'wallet: the ledger did not answer';

/** A sequence number somebody else's transfer used first, or a destination that
 *  can hold no more. Neither is explained: the first is how a holder of a key
 *  finds out they are not the only one. */
const TURNED_DOWN = 'wallet: the ledger refused the transfer';

const refusal = (message: string): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content: message }],
  exitCode: 1,
});

/** One line of what the wallet has to say when nothing went wrong. */
const said = (content: string): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'text', content }],
  exitCode: 0,
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

/** Where the wallet of the account running the command lives. */
const placeOf = (
  session: CommandEnv['session'],
): { readonly home: AbsPath; readonly walletDirectory: AbsPath; readonly walletPath: AbsPath } => {
  const home = homeDirectory(session);
  const walletDirectory = asAbsPath(`${home}/.wallet`);
  return { home, walletDirectory, walletPath: asAbsPath(`${walletDirectory}/wallet.dat`) };
};

const init = async (env: CommandEnv): Promise<CommandResult> => {
  const { home, walletDirectory, walletPath } = placeOf(env.session);
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

type Refused = { readonly refused: string };

/** The key of the wallet in place, and the address read off it, or why there is
 *  none to use. */
const keyInPlace = (env: CommandEnv): WalletKey | Refused => {
  const { walletPath } = placeOf(env.session);
  const stored = env.fs.read(walletPath);
  if (!stored.ok) {
    if (stored.error === 'not_found') return { refused: `no wallet at ${walletPath}` };
    if (stored.error === 'permission_denied') {
      return { refused: `can't read '${walletPath}': Permission denied` };
    }
    return { refused: `no key in ${walletPath}` };
  }
  return readWalletFile(stored.content) ?? { refused: `no key in ${walletPath}` };
};

/** The address a question to the ledger is about, or the refusal that stops it
 *  being asked: the one named, or with none named the wallet in place's. */
const addressAsked = (env: CommandEnv, named: readonly string[]): string | CommandResult => {
  if (named.length > 1) return refusal(USAGE);
  const [text] = named;
  const asked: { readonly address: string } | Refused =
    text === undefined
      ? keyInPlace(env)
      : isAddress(text)
        ? { address: text }
        : { refused: `'${text}' is not an address` };
  // What is wrong with the question comes before what is wrong with the network:
  // joining one would not have made either of these answerable.
  if ('refused' in asked) return refusal(`wallet: ${asked.refused}`);
  if (vantageOf(env.session, env.network) === null) return refusal(UNREACHABLE);
  return asked.address;
};

const balance = async (env: CommandEnv, named: readonly string[]): Promise<CommandResult> => {
  const address = addressAsked(env, named);
  if (typeof address !== 'string') return address;

  const held = await env.wallet.balance(address);
  if (!held.ok) return refusal(NO_ANSWER);
  return said(`${address}  ${held.balance} JSC`);
};

const history = async (env: CommandEnv, named: readonly string[]): Promise<CommandResult> => {
  const address = addressAsked(env, named);
  if (typeof address !== 'string') return address;

  const found = await env.wallet.history(address);
  if (!found.ok) return refusal(NO_ANSWER);
  // An address that has done nothing prints nothing: the ledger cannot tell a
  // wallet nobody has paid from one that was mistyped, and neither is a failure.
  return {
    kind: 'sync',
    lines: found.transfers.map((transfer) => ({
      kind: 'text',
      content: historyLine(address, transfer),
    })),
    exitCode: 0,
  };
};

const send = async (env: CommandEnv, named: readonly string[]): Promise<CommandResult> => {
  if (named.length !== 2) return refusal(USAGE);
  const [to, amountText] = named;
  // What was typed is judged before the wallet is looked for, and the wallet
  // before the network: none of these would be mended by the one after it.
  if (!isAddress(to)) return refusal(`wallet: '${to}' is not an address`);
  const amount = readAmount(amountText);
  if (amount === null) return refusal(`wallet: '${amountText}' is not an amount`);
  const key = keyInPlace(env);
  if ('refused' in key) return refusal(`wallet: ${key.refused}`);
  if (to === key.address) return refusal(`wallet: can't send to this wallet's own address`);
  if (vantageOf(env.session, env.network) === null) return refusal(UNREACHABLE);

  // The balance is read for the sequence number alone. Whether it covers the
  // amount is the ledger's to say when the transfer reaches it: what was read
  // here may already be out of date, and one rule is kept in one place.
  const held = await env.wallet.balance(key.address);
  if (!held.ok) return refusal(NO_ANSWER);
  const made = await env.wallet.transfer({
    keyHex: key.keyHex,
    to,
    amount,
    sequence: held.nextSequence,
  });
  if (made.ok) return said(`sent ${amount} JSC to ${to}`);
  if (made.error === 'network_error') return refusal(NO_ANSWER);
  if (made.error === 'insufficient_balance') {
    return refusal(`wallet: not enough JSC at ${key.address}`);
  }
  return refusal(TURNED_DOWN);
};

const execute = async (env: CommandEnv, args: readonly string[]): Promise<CommandResult> => {
  const [subcommand, ...rest] = args;
  if (subcommand === 'init') return init(env);
  if (subcommand === 'balance') return balance(env, rest);
  if (subcommand === 'history') return history(env, rest);
  if (subcommand === 'send') return send(env, rest);
  return refusal(USAGE);
};

export const wallet: Command = {
  name: 'wallet',
  description: 'Hold and send JSC',
  category: 'network',
  tier: 'guest',
  availability: { kind: 'installed-package', packageName: 'wallet' },
  manual: {
    synopsis: SYNOPSIS,
    description:
      'Keep JSC, the coin of this world. "init" makes a new wallet: a key, and the address that key answers to. It writes both to .wallet/wallet.dat in the home directory of the account running it, as two lines marked "address:" and "key:", then prints the address and the path of the file. The address is what you give to whoever is paying you. The key is the wallet - the coins at an address belong to whoever holds its key and nothing else is asked, so the file is the money. It opens for the account that made it and for root. Each account on a box has a wallet of its own, and "init" refuses when one is already in place: it never replaces a key. Making a wallet needs no network. "balance" prints an address and the JSC held at it. The ledger is public, so it answers for any address and asks for no key; with no address it reads the key in the wallet in place and answers for that one. An address nothing was ever sent to holds 0 JSC, and so does a mistyped one. Asking the ledger needs a network. "history" prints what an address has sent and received, newest first, one transfer to a line: when the ledger recorded it, in UTC, then the JSC that came in or went out, then the address at the other end. Coins that were minted read as coming from coinbase, which is a word and not an address. It shows the latest 20 transfers and no more. Like "balance" it answers for any address and asks for no key, and with no address it answers for the wallet in place. An address that has done nothing prints nothing. "send" moves JSC from the wallet in place to an address. The transfer is signed by the key in the file and by nothing else, so whoever holds a copy of the key can send, from any box. The amount is a whole number of coins written in digits. Nothing checks that anybody holds the address the coins go to, and nothing brings a transfer back. A wallet cannot send more than it holds, or to its own address. Sending needs a network. The same ledger can be read on the web at chainit.io: any address, the latest transfers, and the richest addresses.',
    arguments: [
      {
        name: 'command',
        description:
          '"init", to make a new wallet for this account, "balance", to see what an address holds, "history", to see what it has sent and received, or "send", to move JSC to an address',
        required: true,
        values: ['init', 'balance', 'history', 'send'],
      },
      {
        name: 'address',
        description:
          'For "balance" and "history": the address to ask about (default: the wallet in place). For "send": the address the JSC go to',
        required: false,
      },
      {
        name: 'amount',
        description: 'For "send": how many JSC to move, as a whole number',
        required: false,
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
      {
        command: 'wallet balance',
        description: 'See what the wallet in place holds',
      },
      {
        command: 'wallet balance jsc3f9a1c07b2d84e5f6a7b8c9d0e1f2a3b4c5d6e7f',
        description: 'See what any address holds, with no key needed',
      },
      {
        command: 'wallet history',
        description: 'See what the wallet in place has sent and received',
      },
      {
        command: 'wallet history jsc3f9a1c07b2d84e5f6a7b8c9d0e1f2a3b4c5d6e7f',
        description: 'See what any address has sent and received, with no key needed',
      },
      {
        command: 'wallet send jsc3f9a1c07b2d84e5f6a7b8c9d0e1f2a3b4c5d6e7f 200',
        description: 'Move 200 JSC from the wallet in place to that address',
      },
    ],
  },
  execute,
};
