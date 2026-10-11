# Plan: crypto wallet

**Status**: Grilled, reviewed for gaps, and sliced. Decisions confirmed by the owner 2026-10-11.
Slices 1 to 5 merged (v0.357.0, PR #653; v0.358.0, PR #654; v0.359.0, PR #655; v0.360.0,
PR #656; v0.361.0, PR #657); slice 6 is next. Nothing in the repo covered money before this file. Where another doc disagrees with it, this file wins.

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
   **Each account has its own wallet, root included.** A root shell's home is `/root`, and
   `apt install` needs root, so a player who runs `wallet init` before leaving `su` gets
   `/root/.wallet/wallet.dat`, which their own account cannot see or use. `init` prints that
   path and nothing explains it. Confirmed in the gap review; rejected there: one wallet per box
   at a fixed path.
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
    **The function holds only what must be atomic**: the balance covers the amount, the
    sequence number matches, both rows are written. Every other rule (the signature, the
    address shape, a positive whole amount, no send to yourself) lives in `core/` with unit
    tests written first, because a wire-check is run by hand and nothing runs it in CI. Settled
    in the gap review; rejected there: every rule inside the function.
17. **The ledger never learns who sent a transfer.** A transfer carries the wallet key's
    signature and nothing about the player, and the ledger stores none.
    Rejected: the player's identity stored beside the transfer in a column no player reads.
    **The operator is not blind, though.** A key file is a journal row like any other file, and
    a row carries its writer's player key, so an operator who queries the journal for wallet
    files can link an address to the players who saved it. No player can see that. Corrected in
    the gap review, where the first wording claimed the operator could not tell; the owner kept
    the decision.

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
  `/home/guest/.wallet/`, and every visitor who logs in as `guest` is that same account, so
  each of them can read it.
- **`send` refuses** an amount above the balance, anything that is not a positive whole number,
  text that is not address-shaped, and a send to its own address.
- **A mint shows in history as coming from `coinbase`.**

## Settled in the gap review (2026-10-11)

Gaps found by reading this plan against the code, each answered by the owner.

- **The wallet needs a network, except `init`.** `balance`, `history`, `send` and `sweep`
  refuse on a box with no connection, in the wording `dig` and `whois` use:
  `wallet: network is unreachable — connect to a network first`. `init` makes a key with no
  network. The check is the one `dig`, `whois` and `apt` make (`network/vantage.ts`): on the
  player's own workstation it is their WiFi card, and in a shell on another box it is that
  box's network, whatever the player's own card is doing. Corrected 2026-10-11 when slice 2's
  criteria were confirmed; the first wording said a hop reads the player's own connection,
  which the code does not do. Rejected: a wallet that reaches the ledger with no connection.
- **`coinbase` is a label, not an address.** It is the word a history line prints for a mint.
  `wallet history coinbase` and `wallet balance coinbase` are refused like any text that is not
  address-shaped, and nothing lists addresses. A player learns an address by reading a key file
  or by trading with its holder; a history shows only that address's own counterparties.
  Rejected: a public coinbase history, which would be a list of every wallet ever paid.
- **What `sweep` refuses.** No wallet in place (it needs a destination before it reads the
  source); a key file that is missing, unreadable at the caller's tier, or holds no valid key,
  which is what an encrypted or damaged file is; and a key file that is the wallet in place. On
  an address holding nothing it prints that there is nothing to sweep and sends no transfer.
  Rejected: `sweep` creating a wallet when none is in place, which is `init`'s job.
- **`wallet history` shows the latest 20 transfers, newest first.** No paging and no flag. Older
  transfers stay stored and no command shows them, so twenty 1 JSC transfers push a theft out
  of sight; accepted. Rejected: the whole history, and a count flag with a server cap.
- **An address the ledger has never seen holds `0 JSC`.** The server cannot tell an unused
  wallet from a typo, so `balance` never answers "unknown address", and its history is empty.
- **Every tier can run `wallet`.** The binary is world-executable, as `gpg`'s is. Once root has
  installed it on a box, the owner, root and any guest shell run it there, each against the
  wallet in their own home. Rejected: owner and root only.
- **Spam on the ledger is an accepted cost.** Anyone can send 1 JSC to any address as often as
  they like, and no endpoint in the game has a rate limit. Each transfer costs its sender a
  coin, and a history reply never exceeds 20 lines. Rejected: a minimum send amount, and a rate
  limit on the endpoint.
- **Coins are not safe before launch.** The repo carries no backward-compatibility burden until
  the multiplayer announce (`.claude/CLAUDE.md`), so a schema change may reset every balance.
- **A restore takes the keys with it.** `scripts/restoreSite.ts` deletes a box's journal, so a
  key file hidden on a site the operator restores is gone, and its coins with it. This is
  "loss is final" applied to a box the player does not own.

## Done when

A two-player browser run at close-out shows all of it through the real terminal. Slice PRs
merge on their unit tests and the wire-check; this one run covers them together.

1. A installs `wallet` and runs `wallet init`.
2. The operator mints 500 JSC to A's address, and A's `wallet balance` reads `500 JSC`.
3. B roots A's box, copies the key home and sweeps it.
4. A's balance reads `0 JSC`, and A's history shows the transfer to B's address.
5. A makes a new wallet and encrypts its key with `gpg -c`; B's second copy sweeps nothing.

## Server shape

- `wallet_balances(address, balance, next_sequence)` and
  `wallet_transfers(from_address, to_address, amount, created_at)`. Two functions are the only
  writers of both: `wallet_mint` credits an address from nowhere, and `wallet_transfer` is the
  function of decision 16. Each arrives with the slice that first calls it.
- A new `api/wallet.ts` endpoint for send, balance and history: a thin Supabase adapter over
  handlers in `core/wallet/`, the shape `api/network.ts` has.
- `scripts/mintCoins.ts` credits through the service role.

## Out of scope

Each goes to `docs/backlog.md`.

- **Recognition**, the other half of a mission reward. Designed with missions.
- **Anything to spend JSC on.** The owner has no use for it in mind yet.
- **Mission payouts.** Missions call the mint when they exist.
- **Generated wallets as loot**, as its own world-content story.

## Design choices made in the slice plan (2026-10-11)

What the grill left to planning, settled here. Each is the planner's proposal, approved with the
plan rather than grilled; change any of them before the slice that builds it starts.

1. **An address is `jsc` followed by the first 40 hex characters of `sha256(public key)`**: 43
   characters, lower case, matching `^jsc[0-9a-f]{40}$`. That pattern is the whole of
   "address-shaped" (decision 7). The public key itself is 64 characters, and two of those do
   not fit one history line.
2. **`wallet.dat` is exactly two lines**, `address: <address>` then `key: <64 hex>`. Every
   command derives the address from the key line and never reads the address line.
3. **A transfer is the signed envelope the game already uses, signed by the wallet key.**
   `core/signedRequest` verifies `{ payload, publicKey, signature }` for any Ed25519 key, so the
   server needs no new cryptography: it verifies the envelope, derives the sending address from
   `publicKey`, and reads `{ action: 'transfer', to, amount, sequence }` from the payload. The
   player's identity key signs nothing here.
4. **Reads carry no signature at all.** `balance` and `history` are plain requests naming an
   address, unlike the signed actions on the other endpoints. A public ledger has nobody to
   authenticate, and a signature would hand the server the player key decision 17 keeps out.
5. **The sequence number is the replay guard.** The endpoints' nonce store is a no-op, so
   without it a captured transfer could be sent again inside the two-minute window. A balance
   read returns `{ balance, nextSequence }`; a transfer names the sequence it read, and the
   function refuses any other.
6. **`sweep` is a `send` of everything, signed by the key in the file.** It reads that
   address's balance and sequence, then transfers the whole balance to the wallet in place. No
   server code of its own. If more coins arrive between the read and the transfer they stay
   behind, and a second sweep takes them.
7. **An amount is digits only, no leading zero, at most 9007199254740991**
   (`Number.MAX_SAFE_INTEGER`). `250.0`, `1e3`, `+5`, `0250` and `250 JSC` are refused. The
   database column is a `bigint`.
8. **Times are UTC, from the row's `created_at`**, the real clock the game's logs use.
9. **Proposed output**, each confirmed with its slice's acceptance criteria:
   - `init`: `address: <address>` then `wallet: <path>`.
   - `balance`: one line, `<address>  250 JSC`.
   - `history`: one line per transfer, `2026-10-11 14:02  +500 JSC  from coinbase` or
     `2026-10-11 14:09  -500 JSC  to <address>`.
10. **`scripts/mintCoins.ts <address> <amount>`** takes `SUPABASE_URL` and
    `SUPABASE_SERVICE_ROLE_KEY` from the environment as `restoreSite.ts` does, prints the host
    it is about to write to, and exits 2 on a malformed address or amount before touching
    anything. Running it twice mints twice.
11. **One wire-check script, `scripts/testWallet.ts`**, grown by each slice that touches `api/`.
12. **The wallet joins the two tool tables every installed tool is in.** `libraryDeps.ts` gets
    `wallet: ['libssl', 'libcrypt']`, and `cve/localExploit.ts` gets `wallet: ['file_read']`: a
    wallet's own flaw turned against its owner leaks a file. Installing the wallet therefore
    widens a box's local attack surface, as every tool does, and gives a second way to a key
    file beside rooting the box. **Owner-confirmed 2026-10-11**; rejected: no pool at all, and
    file read plus file write.

## Slices

Each is one PR against `main`, cut after the one before it merges, and each bumps the version.
No stack: nothing here is worth holding two branches open for. Every slice changes behaviour, so
each runs RED-GREEN-REFACTOR (`tdd`, `testing`, and `refactoring` after green), with its
acceptance criteria confirmed by the owner before any code. Mutation testing runs once per slice
when it is otherwise ready for its PR, scoped to the files the slice changed; the SQL has no
mutants to run, and its evidence is the wire-check.

Gates for every slice: `npm run typecheck`, `npm run lint`, `npm run test:run`. A slice that
touches `api/` or `supabase/` also needs `scripts/testWallet.ts` passing against `vercel dev` and
local supabase, and its migration pushed to `jshack-dev` and `jshack-prod` **before** its PR
merges, since a merge deploys code that expects the schema.

### Slice 1: a player makes a wallet (v0.357.0)

**Value**: a player on any box installs `wallet`, runs `wallet init`, and holds a key file that
`cat` shows and a visitor with the tier can copy.
**Path**: `apt install wallet` → `commands/wallet.ts` → `core/wallet/` (key, address, file
format) → `env.patches` writes `~/.wallet/wallet.dat`. Client only; no server.
**Acceptance criteria**:

- `apt install wallet` puts a world-executable `wallet` on the box; before it, the shell gives
  the usual install hint.
- `wallet init` in a user shell writes `/home/<username>/.wallet/wallet.dat`, readable and
  writable by that account and root only, in a `.wallet` directory with the same reach. In a
  root shell the path is `/root/.wallet/wallet.dat`; in a guest shell,
  `/home/guest/.wallet/wallet.dat`.
- The file is the two lines of choice 2, and the address on its first line is the one derived
  from the key on its second.
- `init` prints the address and the path and nothing else, and works with no network.
- A second `wallet init` prints that a wallet already exists, exits non-zero and leaves the
  file as it was.
- Two `init`s on two boxes produce different keys.
- Bare `wallet`, and an unknown subcommand, print the usage and exit non-zero.
- `man wallet` documents `init`.
- The tool tables hold the two rows of choice 12.

**First failing test**: `wallet init` on a box with no wallet writes a `wallet.dat` whose address
line is derived from its key line.
**Wire-check**: `N/A`, no `api/` change.

**Merged 2026-10-11, PR #653.** As built, beyond the criteria above:

- **Wordings.** `wallet: a wallet already exists at <path>`;
  `wallet: can't create '<path>': <reason>` when the home is missing or not writable, `.wallet`
  is a file, or the box turns a write down; `wallet: usage: wallet init`. The usage line names
  only what works, so each later slice extends it, along with the manual's synopsis and its
  first argument's `values`, which is what tab completion offers.
- **"Exists" is anything at the path**, a file with no key in it included, and it is asked of
  the machine (`env.fs.reload()`), so a wallet made in another terminal is not replaced.
- **Reach is stamped, not inherited.** `wallet.dat` is `[root, <tier>]` for read and write and
  executable by nobody; `.wallet` is `[root, <tier>]` for read, write and enter. `init` makes
  the directory, then narrows it, then writes the key, and stops at the first step the box
  refuses. A `.wallet` already there is kept, narrowed and not made again.
- **`help` files it under Network.** The registry guard that sorts Network commands records
  `wallet` as box-local: it talks to the ledger, which is no machine.
- **Code**: `core/commands/wallet.ts`, and `core/wallet/walletKey.ts` for the key, the address
  rule and the file format. Slices 2 to 6 need two things it does not have yet: a check that
  text is address-shaped, and reading a key back out of a file.

### Slice 2: anyone can read a balance (v0.358.0)

**Value**: a player asks what an address holds and the ledger answers, for their own wallet or
anybody's.
**Path**: `wallet balance [address]` → `env.wallet.balance` → `POST /api/wallet` →
`core/wallet/handleWalletBalance` → `wallet_balances`. The walking skeleton of the server half.
**Acceptance criteria**:

Confirmed by the owner 2026-10-11, with the wordings.

- `wallet balance <address>` prints one line, `<address>  250 JSC`, and exits 0, with no key
  file needed.
- `wallet balance` with no argument derives the address from the key line of
  `~/.wallet/wallet.dat` and prints the same line. The file's address line is never read.
- An address the ledger has never seen reads `0 JSC`.
- Refused before any request is made: no wallet in place (`wallet: no wallet at <path>`); a
  file with no valid key line (`wallet: no key in <path>`); a file the caller's tier cannot
  read (`wallet: can't read '<path>': Permission denied`); text that is not address-shaped,
  `coinbase` and upper case included (`wallet: '<text>' is not an address`); and more than one
  argument (the usage line).
- With nowhere to send from the command prints
  `wallet: network is unreachable — connect to a network first` and makes no request. A bad
  address or a missing wallet is reported first.
- A failed request prints `wallet: the ledger did not answer` and exits non-zero; it never
  prints a balance.
- The usage line is `wallet: usage: wallet init | balance [address]`; `man wallet` documents
  `balance` and tab completion offers it.
- `POST /api/wallet` with `{ action: 'balance', address }`, unsigned, answers
  `{ balance, nextSequence }`. An unseen address answers zero for both and writes no row. A
  malformed address or an unknown action is a 400, anything but POST a 405, and a failed read
  a 500 with no balance in it.
- A balance is held between 0 and 9007199254740991, so it reaches the browser as an exact
  number. A later mint or transfer that would pass the ceiling is refused.

**First failing test**: `wallet balance <address>` prints the balance the ledger returns for it.
**Migration**: `wallet_balances(address, balance, next_sequence)`, the address column checking
the address shape, row security on with no policies.
**Wire-check**: `scripts/testWallet.ts` — an unseen address reads 0 with sequence 0; a malformed
address is a 400.

**Merged 2026-10-11, PR #654.** The migration is on jshack-dev and jshack-prod. As built, beyond
the criteria above:

- **A `wallet.dat` that is a directory reads as `no key in <path>`**, like a file with no key
  line.
- **A key line is `key: ` at the start of a line and 64 lower-case hex characters to its end**,
  wherever it sits in the file. Upper case, a short key and text before the label are no key.
- **The endpoint's errors**: `unknown_action` for anything but `{ action: 'balance' }`,
  `invalid_address`, and `balance_lookup_failed` (500) for a failed read or a row whose counts
  are not exact non-negative whole numbers. Later slices route their own actions in
  `api/wallet.ts` ahead of the balance read.
- **To the command, every failure to get a balance is one answer**, `network_error`: a status
  that is not ok is never read for a number.
- **The table carries its own rules.** The address shape, a balance from 0 to 9007199254740991
  and a sequence number in the same range are CHECK constraints, so `wallet_mint` and
  `wallet_transfer` get a `23514` rather than a rounded balance when a credit would pass the
  ceiling. Each has to turn that into its own refusal.
- **Code**: `env.wallet` (`WalletApi` in `commands/types.ts`), `adapters/walletApi.ts`,
  `core/wallet/handleWalletBalance.ts`, and `core/wallet/exactCount.ts` for the bounds both
  sides of the wire share. `walletKey.ts` now has `isAddress` and `readWalletFile`, the two
  things slice 1 left open, and `identity.ts` has `publicKeyOf`. `sweep` still needs its own
  reading of a key file at a path the player names.
- **The wire-check goes further than planned**: a held row read back, the largest balance digit
  for digit, the table's refusals, and the anon key reading nothing. Slices 3 to 6 extend it.
- **`npm run build`'s wall-clock budgets were unreliable on the development machine that day**,
  on `main` as well as the branch; the Vercel build passed them.

### Slice 3: the operator mints coins (v0.359.0)

**Value**: the operator credits an address, and the player holding it sees the coins.
**Path**: `scripts/mintCoins.ts` → `wallet_mint` → `wallet_balances` and `wallet_transfers`;
observed through slice 2's `wallet balance`.
**Acceptance criteria**:

Confirmed by the owner 2026-10-11, with the wordings.

- `mintCoins.ts <address> 500` raises that address's balance by 500 and records one transfer
  of 500 to it with no sender. Running it twice mints twice.
- Minting to an address the ledger has never seen creates it, with sequence 0.
- A mint never changes an address's sequence number.
- It prints `Minting 500 JSC to <address> on <host>` before it writes and the address's new
  balance after, as the line `wallet balance` prints: `<address>  1000 JSC`.
- Exit 2 with `Usage: mintCoins.ts <address> <amount>` on stderr, nothing written: text that is
  not address-shaped; an amount that is not digits only, with no leading zero, from 1 to
  9007199254740991; too few or too many arguments.
- Exit 2 on missing `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY`, checked after the
  arguments.
- A mint that would take an address past 9007199254740991 prints
  `mint refused: <address> would hold more than 9007199254740991 JSC`, exits 1, and leaves the
  balance and the transfers as they were. Any other database failure exits 1 with its message.
- No confirmation prompt anywhere. The host line is the only guard.
- `wallet_transfers` refuses an amount below 1 or past the ceiling, a sender or destination
  that is not address-shaped, and a sender equal to the destination.
- `wallet_mint` credits the balance and writes the transfer row together or not at all.
- Only the service role can mint. The anon key can neither call `wallet_mint` nor read
  `wallet_transfers`.

**First failing test**: the argument check, as a pure function in `core/wallet/` the script
calls: a malformed address or amount is refused.
**Migration**: `wallet_transfers`, `wallet_mint`.
**Wire-check**: mint 500, read 500; mint again, read 1000; the two transfer rows exist with a
null sender.

**Merged 2026-10-11, PR #655.** The migration is on jshack-dev and jshack-prod. Nothing has been
minted on either. As built, beyond the criteria above:

- **`wallet_mint(mint_to, mint_amount)` answers the new balance, or NULL when the credit would
  not fit**, having written nothing. The script reads NULL as the refusal. `wallet_transfer`
  has the same ceiling to meet at its destination and needs its own way to say so.
- **The function does not check the amount.** An amount below 1 is refused by the transfer
  row's CHECK (`23514`), and that failure takes the credit back with it. The wire-check calls
  the function directly with 0 and with -5 to show it.
- **EXECUTE is revoked from `PUBLIC`, `anon` and `authenticated` and granted to `service_role`.**
  Supabase's default privileges name the two roles, so revoking from `PUBLIC` alone leaves the
  function open. `wallet_transfer` needs the same three lines. A wire-check of it has to read
  the error message (`permission denied for function ...`): row security answers the same code,
  `42501`.
- **`wallet_transfers` has an `id` identity column**, which orders two transfers made in the
  same instant. `created_at` is the transaction's start. The history slice sorts by `id`.
- **The amount rule lives inside `core/wallet/mintOrder.ts`** (`readMintOrder`), not on its
  own. `wallet send` takes the same rule, so slice 4 lifts it out when it becomes the second
  caller.
- **Missions will mint by calling `wallet_mint` from the server**, not by running the script.
  The script is the argument check, the host line and one `rpc` call.
- **The wire-check runs the real script as a child process**, as `testRestoreSite.ts` runs the
  restore, and is at 40 checks: the ceiling from both sides (501 refused, 500 landing exactly
  on it), a mint to an address at sequence 3, bad arguments, a withheld service key, and the
  table's refusals. Its cleanup deletes transfers by destination; slice 4's transfers need
  deleting by sender as well.

### Slice 4: a player sends coins (v0.360.0)

**Value**: whoever holds a key moves its coins to another address. With this slice a stolen key
is already spendable, by putting it in place of your own.
**Path**: `wallet send <address> <amount>` → balance read for the sequence → envelope signed by
the wallet key → `POST /api/wallet` → `core/wallet/handleWalletTransfer` (signature, address
shape, amount, not to yourself) → `wallet_transfer` (balance covers it, sequence matches, both
rows written).
**Acceptance criteria**:

Confirmed by the owner 2026-10-11, with the wordings.

- `wallet send <address> <amount>` from a wallet holding 500 moves 200, prints
  `sent 200 JSC to <address>` and exits 0. The sender then reads 300 and the destination 200
  more. A send to a well-formed address nobody holds succeeds.
- Refused before any request, in this order: anything but two arguments (the usage line); a
  destination that is not address-shaped (`wallet: '<text>' is not an address`); an amount
  outside choice 7 (`wallet: '<text>' is not an amount`); a missing, keyless or unreadable
  wallet (the three wordings `balance` uses); the wallet's own address
  (`wallet: can't send to this wallet's own address`); no network (the wording `balance`
  uses).
- The command reads the balance for the sequence number, then sends one transfer signed by the
  wallet key. Nothing of the player's identity goes with it.
- **The ledger decides whether the balance covers the amount; the command does not check
  first.** A short balance prints `wallet: not enough JSC at <address>`, naming the sender, and
  nothing moves. Rejected: a client check that could also print what the wallet holds.
- A stale sequence (another holder of the key sent first) or a destination at the ceiling
  prints `wallet: the ledger refused the transfer`. A failed balance read, a failed transfer
  request or an unreadable answer prints `wallet: the ledger did not answer`. Every refusal
  exits non-zero.
- No log on any box gains a line, and the command writes nothing to the box.
- The usage line is `wallet: usage: wallet init | balance [address] | send <address> <amount>`;
  `man wallet` documents `send` and tab completion offers it.
- `POST /api/wallet` takes a signed envelope whose payload is
  `{ action: 'transfer', to, amount, sequence }`. The sender is the address of the envelope's
  public key and is never named in the payload. Success is 200 `{ ok: true }`; the unsigned
  balance read works as before.
- Its refusals, with nothing written: 400 `payload_invalid` (a `to` that is not
  address-shaped, an `amount` that is not a whole number from 1 to the ceiling, a `sequence`
  that is not a whole number from 0), 400 `self_transfer`, 401 `signature_invalid`, 401
  `timestamp_skew`, 409 `stale_sequence`, 409 `insufficient_balance`, 409 `destination_full`,
  500 `transfer_failed`.
- The sequence is checked before the balance, so a replayed transfer always answers
  `stale_sequence`.
- `wallet_transfer` debits, credits and records the transfer row together or not at all. A
  transfer raises the sender's sequence by exactly one and leaves the destination's alone; a
  refused one leaves the sender's alone. A destination the ledger has never seen is created at
  sequence 0.
- The same signed transfer sent twice moves the coins once. Of two transfers at one sequence
  sent together, exactly one lands.
- Only the service role can call `wallet_transfer`.
- The sum of all balances equals the sum minted throughout the wire-check.

**First failing test**: `handleWalletTransfer` moves the amount when the envelope is signed by
the sending address's key.
**Migration**: `wallet_transfer`.
**Wire-check**: the send, the short balance, the replay, and two concurrent transfers at one
sequence of which exactly one lands; the sum of all balances equals the sum minted throughout.

**Merged 2026-10-11, PR #656.** The migration is on jshack-dev and jshack-prod. Nothing has been
minted or sent on either. As built, beyond the criteria above:

- **`wallet_transfer(transfer_from, transfer_to, transfer_amount, transfer_sequence)` answers a
  word**: `moved`, or one of the three refusals. Anything else, or a database error, is the
  handler's 500.
- **It locks both balance rows before it reads either, lower address first.** Two transfers at
  one sequence queue on the sender's row, and two wallets paying each other at once take their
  locks in one order instead of deadlocking. The wire-check runs both, five rounds each.
- **It is `STRICT`**: a missing argument answers NULL and nothing runs.
- **It does not check the amount or the self-send**, as `wallet_mint` does not check the
  amount. The transfer row's CHECKs refuse both, and that failure takes the debit, the credit
  and the sequence number back with it.
- **An address with no row holds nothing at sequence 0.** A send from it is
  `insufficient_balance` and makes no row at either end.
- **`api/wallet.ts` routes on the body**: a string `payload` is a transfer, anything else is
  the balance read. An unsigned `{ action: 'transfer' }` is therefore `unknown_action`. The
  history slice adds a second unsigned action, which belongs on the read side of that fork.
- **No nonce is kept**, as on the other endpoints. The sequence number is the replay guard,
  and the two-minute timestamp window still applies.
- **Code**: `core/wallet/handleWalletTransfer.ts`; `sendTransfer` in `adapters/walletApi.ts`;
  `env.wallet.transfer({ keyHex, to, amount, sequence })`, which signs in the adapter;
  `core/wallet/amount.ts` (`readAmount`), lifted out of `mintOrder.ts`; `addressOfPublicKey`
  and `signerOf` in `walletKey.ts`. `signRequest` takes any key pair (`Signer`), not only a
  player identity.
- **To the command a transfer has five outcomes**: made, the three refusals, and
  `network_error` for everything else, a 400 or a 401 included. After a `network_error` the
  coins may have moved or not, and the command does not say which.
- **What `sweep` can reuse**: `env.wallet.transfer` takes whatever key it is handed, so a
  sweep is a balance read and one call with the file's key. `keyInPlace` in
  `commands/wallet.ts` reads only `~/.wallet/wallet.dat`; sweep still needs its own reading of
  a key file at a path the player names. A sweep of an address holding nothing must stop before
  the transfer: an amount of 0 is refused by the server as `payload_invalid`.
- **A test at the real terminal** (`ui/state.test.ts`) runs `wallet init` then `wallet send`
  and hands the posted envelope to the ledger's handler: it is taken as coming from the address
  `init` printed, and its public key is not the player's.
- **The wire-check is at 78 checks.** Its cleanup deletes transfers by sender as well as by
  destination. The transfer checks use their own addresses, funded only by `wallet_mint`, so
  what they hold is compared with what was minted, as a `bigint`.
- **Mutation**: 329 killed, 22 survived over the six wallet files. One was an equivalent
  mutant on a line since simplified away. The other 21 are the command's static metadata
  (name, tier, availability, manual prose), none in `send`'s logic.
- **A full test run under load fails on timeouts.** One run that overlapped other work took
  over ten minutes and failed 5 heavy world-generation and reboot tests; alone it takes about
  three minutes and passes.

### Slice 5: a player sweeps a key file (v0.361.0)

**Value**: a thief empties a copied key into their own wallet with one command, and an owner
moves to a new key without swapping files.
**Path**: `wallet sweep <keyfile>` → read the file at the caller's tier → slice 4's transfer,
signed by that file's key, to the wallet in place. Client only (choice 6).
**Acceptance criteria**:

Confirmed by the owner 2026-10-11, with the wordings.

- `wallet sweep loot.dat`, where the file's address holds 500, sends one transfer of 500 to the
  wallet in place, signed by the file's key, prints `swept 500 JSC from <file's address>` and
  exits 0. The line names the source and not the destination, which is always the player's own
  wallet. Rejected: naming both addresses.
- The path is resolved against the current directory and read at the caller's tier, as `gpg`
  reads its file. The address comes from the key line; an address line that says something
  else is ignored.
- The command writes nothing to the box, leaves the key file where it is, and no log gains a
  line. Coins that arrive after the balance is read stay behind, and a second sweep takes them.
- Refused before any request, in this order: anything but one argument (the usage line); a
  missing, keyless or unreadable wallet in place (the three wordings `balance` and `send`
  use); a key file that is missing, unreadable at this tier or a directory
  (`wallet: can't read '<as typed>': No such file or directory`, `Permission denied`,
  `Is a directory`); a file with no valid key line, a `.gpg` file among them
  (`wallet: no key in <as typed>`); a file whose key is the wallet in place's key
  (`wallet: can't sweep this wallet's own key`); no network (the wording `balance` uses).
- The own-key check compares keys and not paths, so a copy of the player's own `wallet.dat`
  kept elsewhere is refused too.
- An address holding nothing prints `nothing to sweep at <file's address>`, sends no transfer
  and exits 0.
- **Every refusal by the ledger prints `wallet: the ledger refused the transfer`**, a short
  balance included. A sweep sends what it just read, so a short balance can only mean another
  holder of the key moved first, which is the same event as a stale sequence. Rejected: the
  line `send` gives a short balance.
- A failed balance read or a failed transfer request prints `wallet: the ledger did not
  answer`. Every refusal exits non-zero.
- The usage line is
  `wallet: usage: wallet init | balance [address] | send <address> <amount> | sweep <keyfile>`;
  `man wallet` documents `sweep` with the example `wallet sweep loot.dat`; tab completion
  offers `sweep`, and the key file argument completes as a path.

**First failing test**: sweeping a key file whose address holds 500 transfers 500 to the wallet
in place.
**Wire-check**: `N/A`, no `api/` change; slice 4's checks cover the transfer it sends.

**Merged 2026-10-11, PR #657.** No migration. Nothing has been minted or sent on either cloud
project. As built, beyond the criteria above:

- **All of it is in `core/commands/wallet.ts`**: `sweep`, and `keyInFile`, which reads a key
  file at a path the player names and words its failures by that path as typed. `keyInPlace`
  still reads only `~/.wallet/wallet.dat`.
- **The files are read from what the terminal last pulled**, as `balance` and `send` read the
  wallet in place. Only `init` asks the machine again.
- **One helper prints a one-line answer** (`said`) for `balance`, `send` and `sweep`, and the
  ledger-refused wording is one constant. `history` prints many lines and needs neither.
- **The manual's arguments are `command`, `address`, `amount`, `keyfile`.** Tab completion
  reads them by position and only `command` carries keywords, which a test now pins; every
  later position is left to path completion. `history [address]` needs no new argument, only
  a wider description of `address` and one more keyword.
- **The usage line lists the subcommands in the order they were built**, not decision 9's
  order. Slice 6 decides where `history` goes in it.
- **An empty path** (`wallet sweep ''`) names the current directory and reads `Is a
  directory`. Not special-cased.
- **No test at the real terminal.** Slice 4's proved new wiring and sweep adds none; the
  command tests cover it, and the close-out run sweeps through the browser.
- **For the close-out run**: what B's second copy prints depends on what B copied. The
  encrypted file prints `wallet: no key in <file>` and exits non-zero; an old plaintext copy of
  the swept key prints `nothing to sweep at <address>` and exits 0.
- **Tests**: `wallet.test.ts` is at 152; the full run, alone, passes 285 files and 8715 tests.
- **Mutation**: 253 killed, 25 survived over `wallet.ts`, no timeouts. All 25 are the
  command's static metadata (name, tier, availability, manual prose, `required` flags, example
  text); three are new with this slice. None is in `sweep` or `keyInFile`.

### Slice 6: anyone can read a history (v0.362.0)

**Value**: a victim sees where their coins went, and anyone can see what an address has done.
**Path**: `wallet history [address]` → `env.wallet.history` → `POST /api/wallet` →
`core/wallet/handleWalletHistory` → `wallet_transfers`.
**Acceptance criteria**:

- `wallet history` lists the own address's transfers, newest first, one line each in the format
  of choice 9: incoming with `+` and its sender, outgoing with `-` and its destination.
- A mint shows as `from coinbase`.
- An address with more than 20 transfers shows the latest 20 and no sign that there are more.
- An address with none prints nothing and exits zero.
- `wallet history <address>` works with no key file; `wallet history coinbase` and other
  malformed text are refused before any request.
- With no network the command refuses as `balance` does.
- `man wallet` documents `history`, completing the page.

**First failing test**: `wallet history <address>` prints one line per transfer the ledger
returns, newest first.
**Migration**: indexes on `wallet_transfers` by sender and by destination, each with
`created_at`.
**Wire-check**: 21 transfers on one address return 20, newest first; a mint row has a null
sender; a malformed address is a 400.

### Slice 7: close-out

Not a code slice. The two-player browser run of "Done when" (`e2e` skill), with anything it
finds fixed as its own slice first. Then an as-built `docs/wallet-architecture.md`, the
`docs/project-status.md` entry, the `docs/backlog.md` entry trimmed to what is still deferred,
and this file deleted.
