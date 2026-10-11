# Plan: crypto wallet

**Status**: Grilled. Decisions confirmed by the owner 2026-10-11; slices not yet planned. Nothing
in the repo covered money before this file. Where another doc disagrees with it, this file wins.

## Goal

A player can hold money. They install `wallet`, run `wallet init`, and get an address to be paid
at and a key file on their box. Whoever holds that key spends the coins, so a wallet is something
to hide, and something another player can take by breaking in. Missions will pay into it later;
this epic ships the wallet, the ledger and the operator's mint, and nothing that creates or
spends a coin in play.

The coin is **JSC**, written `250 JSC`.

## Where it starts from (facts, 2026-10-11)

- **No money exists anywhere.** No table, command or generator knows a balance. Legacy missions
  paid nothing either (`docs/mission-ideas/mission-loop.md` §4.3).
- **Missions are postponed** (2026-10-07, `docs/project-status.md`), so on the day this ships
  nothing in the game creates a coin.
- **A machine's filesystem is the shared journal.** A file on a box is readable by whoever holds
  the tier, with `cat`, `scp` or `ftp get`, and by the server.
- **Three tiers: `guest`, `user`, `root`** (`core/types.ts`). `/home/<username>` and its files
  are readable by the owner and root, not by `guest`; `/home/guest` is readable by every tier
  (`generation/baseFs.ts`).
- **A visitor arrives as `guest` or as `root`.** `guest` falls to the wordlist on every
  workstation; the owner's own login has no password, so nobody else arrives as `user`; root is
  the CVE route.
- **`gpg -c` is the one protection that survives a rooted box** (`commands/gpg.ts`). Its key is
  `md5(passphrase)`, weak on purpose, so a poor passphrase falls to outside cracking.
- **A bricked workstation is permanent**, and a new identity is the only way back
  (`docs/cross-player-architecture.md` §7).
- **The player's identity is already an Ed25519 key pair** in the browser's `localStorage`
  (`core/identity/identity.ts`), and `@noble/ed25519` is in the bundle.
- **`api/` holds three endpoints** (`patches`, `sessions`, `network`), and the migrations hold one
  trigger function and no logic. Nothing changes more than one row as a unit today.
- **Tools run where you stand**: `apt install` works on any box the player holds root on, and an
  installed binary runs for whoever can execute it.

## Decisions (owner-confirmed 2026-10-11)

All grilled singly.

1. **The key owns the money.** The ledger is keyed by address and no player identity appears in
   it. Anyone who can produce the key spends, from any machine. Rejected: a balance owned by the
   player account with the file as an unlock token (a stolen copy is worthless), and a key that
   only spends on the box it was made on (a brick burns the money with no backup possible).
2. **Operator mint only.** `scripts/mintCoins.ts <address> <amount>` credits an address;
   missions will call the same mint. Rejected: generated wallets as loot (reverses the
   world-content rule that generated boxes hold no loot, and needs a supply curve) and a grant on
   `wallet init` (an identity is free, so it is an unlimited farm).
3. **The key lives at `~/.wallet/wallet.dat`**, in the home of the account that ran
   `wallet init`, readable by that account and root. Taking it from a player means rooting their
   box. Rejected: a root-only system path (the owner needs `su` for every use) and a file every
   tier can read (any guest shell takes it).
4. **The ledger is public.** `wallet balance <address>` and `wallet history <address>` answer
   for any address; the key is needed only to send. A player who hid their key still watches
   their coins, and a victim sees the address the coins went to, never a name. Rejected: public
   balance with no history, and balance and history for the key holder only.
5. **A real key and a signed send.** `wallet.dat` holds a random Ed25519 private key made in the
   browser, not derived from the player's identity. `wallet send` signs the transfer and the
   server checks only that signature: no machine, session or tier check. Rejected: a token the
   server reads from the journal of the box the caller stands on, as hydra's wordlist is read.
6. **`wallet sweep <keyfile>` moves everything.** It empties the given key file's address into
   the wallet in place, so the destination key is on disk before any coin moves. It serves the
   thief (`wallet sweep loot.dat`) and the owner changing keys (move the old file aside,
   `wallet init`, sweep the old file). `wallet init` refuses when a wallet exists, and the
   command reads only `~/.wallet/wallet.dat`, with no `-f` flag. Rejected: `wallet init` offering
   to move the old wallet's funds (the owner's first idea: a thief still swaps files by hand, and
   a failed write after the transfer burns the coins), both, and file swapping alone.
7. **No checksum: a mistyped address takes the coins for good.** Any text of the right shape is
   an address. Rejected: check characters that refuse a typo (recommended, declined), and
   accepting only addresses `wallet init` registered (init would need the server).
8. **`wallet.dat` is two labelled text lines, address and key.** `cat` shows both, so a thief
   reads the address off the file and can check what it holds. Only the key line counts.
   Rejected: the key alone, and an opaque blob.
9. **Five subcommands**: `init`, `balance [address]`, `history [address]`,
   `send <address> <amount>`, `sweep <keyfile>`. With no argument `balance` prints the player's
   own address and what it holds, so there is no `address` subcommand. Bare `wallet` prints the
   usage.
10. **Whole coins, no fee.** Amounts are positive integers. Rejected: decimals, and a flat fee as
    a first sink.
11. **The coin is JSC.** First answered HKC, changed at confirmation.
12. **No wallet passphrase.** Protection is the tools that exist: delete the file, `gpg -c` it and
    remove the plaintext, or `scp` it to another box, and put it back to send. Rejected: an
    optional passphrase and a mandatory one.
13. **`wallet init` prints the address and the path of the file it wrote, and nothing else.** No
    backup warning, not even one factual line.
14. **`send` and `sweep` write no log line on any box.** A transfer is a message to the ledger,
    not a connection to a machine. The evidence of a theft is the break-in's own trace plus the
    destination address in the public history. Rejected: a line on the box the command ran on.
15. **`man wallet` is the only teaching.** No hackademy chapter and no `README` line until
    missions pay.
16. **One Postgres function moves the coins.** It debits, credits and records the transfer in
    one transaction, and refuses a short balance or a stale sequence number. It is the first
    stored procedure with logic in the repo; a wire-check proves it. Rejected: three separate
    calls from the endpoint (a failure between them destroys coins).
17. **The ledger never learns who sent a transfer.** A transfer carries the wallet key's
    signature and nothing about the player; not even the operator can say who emptied a wallet.
    Rejected: the player's identity stored beside the transfer in a column no player reads.

## What follows from the decisions

Shown to the owner with the decisions and confirmed with them.

- **Loss is final.** A deleted key, a bricked box or a cleared browser leaves the coins visible
  at their address and unspendable. The operator can mint again but never restores a key.
- **Two holders of one key race.** The first transfer to land wins and nothing detects a copy.
  The remedy is the player's: `wallet init` and `wallet sweep`.
- **The wallet is not tied to identity.** A player who starts over with a new identity keeps
  their coins if they kept the key text.
- **It runs wherever it is installed.** `apt install wallet` needs root on that box, and the
  wallet lands in the home of the account that ran `init`. One made in a `guest` shell sits in
  `/home/guest`, which every tier can read.
- **`send` refuses** an amount above the balance, anything that is not a positive whole number,
  text that is not address-shaped, and a send to its own address.
- **A mint shows in history as coming from `coinbase`.**

## Server shape

- `wallet_balances(address, balance, next_sequence)` and
  `wallet_transfers(from_address, to_address, amount, created_at)`, with the function of
  decision 16 as the only writer of both.
- A new `api/wallet.ts` endpoint for send, balance and history.
- `scripts/mintCoins.ts` credits through the service role.

## Out of scope

Each goes to `docs/backlog.md`.

- **Recognition**, the other half of a mission reward. Designed with missions.
- **Anything to spend JSC on.** The owner has no use for it in mind yet.
- **Mission payouts.** Missions call the mint when they exist.
- **Generated wallets as loot**, as its own world-content story.

## Left to the slice plan

- The address's shape and length, and how it is derived from the public key.
- What the signed transfer message contains, and how a sweep reads the sequence number.
- Whether balance and history reads sit inside the signed-envelope convention the other
  endpoints use, given decision 17.
- The line format of `balance` and `history`.
- The wire-check script and the slice order.
