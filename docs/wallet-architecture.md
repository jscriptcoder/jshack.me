# Wallet architecture (as-built)

How a player holds money in the game: the `wallet` command, a public ledger of **JSC**
keyed by address, and the operator's mint. This is the shipped model of the crypto-wallet
epic, complete at **v0.362.0**. The grill record and slice plan were retired on close-out;
what the epic deliberately left out is in `backlog.md` under "Crypto wallet deferred". When
this doc and the code disagree, the code wins — fix the doc.

The epic shipped a fifth subcommand, `sweep <keyfile>`, which emptied a named key file into
the wallet in place. It was removed at **v0.367.0**: it did nothing `balance` and `send`
could not, and it read as a tool made for looting. Coins now leave an address by one route.

## The one idea the design turns on

**The key is the money.** A wallet is a random Ed25519 key in a file on a box; the ledger
is keyed by the *address* that key answers to and knows nothing else — no player, machine,
session or tier appears in it. Whoever can produce the key spends the coins at its address,
from any box. So a wallet is something to **hide** (delete it, `gpg -c` it, `scp` it away)
and something another player can **take** by breaking in and reading the file. Defending it
is gameplay, exactly as the identity/wallet split in `docs/legacy/` always intended.

Everything that follows is that idea made concrete: reads are public and unsigned, a
transfer is signed by the *wallet* key (never the player's identity), and loss is final.

## 1. The server: two tables, two functions, one endpoint

**Tables** (zero-trust, mirroring the rest of the schema: RLS on, **no policies**, so anon
and authenticated are denied; `service_role` bypasses RLS and is the only reader or writer,
always through the Vercel function — the ledger is public by what that function *answers*,
not by any grant on the table):

- **`wallet_balances(address PK, balance, next_sequence)`**
  (`20261011000000_wallet_balances.sql`). A row exists only for an address that has been
  paid; reading an unknown address answers zero and writes nothing, so a mistyped address
  leaves no trace. `next_sequence` is the number the next transfer *out* must name — the
  replay guard. CHECKs hold whoever writes: `address ~ '^jsc[0-9a-f]{40}$'`, and both
  columns `BETWEEN 0 AND 9007199254740991` (`Number.MAX_SAFE_INTEGER` — a credit past it
  fails here rather than reaching a player rounded).

- **`wallet_transfers(id IDENTITY PK, from_address, to_address, amount, created_at)`**
  (`20261011010000_wallet_transfers_and_mint.sql`). One row per movement, naming no player.
  A **mint** is a transfer with `from_address IS NULL` — that NULL is the only mark of where
  minted coins came from; `coinbase` is the *command's* word for it, never the ledger's.
  `id` orders two transfers that share an instant, which `created_at` cannot. CHECKs: both
  addresses address-shaped (a NULL sender passes — it is a mint), `amount BETWEEN 1 AND
  9007199254740991`, and `from_address <> to_address`.

**Functions** (the only writers; `EXECUTE` revoked from `PUBLIC`, `anon`, `authenticated`
and granted to `service_role` alone — nothing a browser holds can mint or move coins):

- **`wallet_mint(mint_to, mint_amount) → BIGINT`**. Credits an address and writes the mint
  row in one transaction, so a balance never rises without the row that says why. Answers
  the new balance, or **NULL** when the credit would overflow the ceiling (the caller is
  told it was refused, not handed a constraint violation). Never touches `next_sequence`.

- **`wallet_transfer(transfer_from, transfer_to, transfer_amount, transfer_sequence) →
  TEXT`** (`20261011020000_wallet_transfer.sql`, decision 16 — the first stored procedure
  with logic in the repo). Debits, credits and records in one transaction; answers a word:
  `moved`, `stale_sequence`, `insufficient_balance`, or `destination_full`. **The function
  holds only what must be atomic**: sequence match, sufficient balance, both rows written.
  The sequence is judged *before* the balance, so a transfer sent twice is always
  `stale_sequence` whatever the sender still holds. Both balance rows are locked lower
  address first, so two transfers crossing between the same pair cannot deadlock. `STRICT`:
  a missing argument answers NULL and nothing runs.

  Every *other* rule — whose key signed, address shape, a positive whole amount, no send to
  yourself — lives in `core/` with unit tests, because a wire-check runs by hand and nothing
  runs it in CI. The tables' CHECKs refuse those too, as a backstop: a zero-amount or
  send-to-self row fails and takes the debit and credit back with it.

- **Indexes** (`20261011030000_wallet_transfers_history_indexes.sql`):
  `(from_address, id DESC)` and `(to_address, id DESC)` — history reads an address as sender
  or destination, newest `id` first. Keyed on `id`, not `created_at`, because the order is
  `id`'s.

**Endpoint** — `POST /api/wallet` (`api/wallet.ts`), a thin Supabase adapter over `core/`
handlers, forking three ways:

1. a body with a **string `payload`** is a signed transfer → `handleWalletTransfer`;
2. `action: 'history'` → `handleWalletHistory`;
3. anything else is a read, taken for a **balance** → `handleWalletBalance`, whose handler
   turns away an action it does not know (`unknown_action`).

No nonce is kept (the endpoints' nonce store is a no-op here); the sequence number is the
whole replay guard.

## 2. The client: one command, four subcommands

`src/core/commands/wallet.ts`, world-executable like `gpg` — every tier can run it, each
against the wallet in its own home.

```
wallet init | balance [address] | history [address] | send <address> <amount>
```

- **`init`** makes a fresh random Ed25519 key, writes `~/.wallet/wallet.dat`, prints
  `address: <address>` then `wallet: <path>` and nothing else (no backup warning — decision
  13). Refuses when a wallet is already in place. Needs no network.
- **`balance [address]`** / **`history [address]`** read the public ledger, unsigned. With
  no argument they answer for the wallet in place. `balance` prints `<address>  <n> JSC`;
  `history` prints the latest **20** transfers, newest first, one line each:
  `2026-10-11 22:07  +500 JSC  from coinbase` (a mint), `… +N JSC  from <address>`
  (incoming), `… -N JSC  to <address>` (outgoing). Direction is `to === address`. An address
  with no transfers prints nothing and exits 0; the manual states the 20 limit.
- **`send <address> <amount>`** signs a transfer with the wallet key and posts it. Refuses an
  over-balance amount, a non-positive-whole amount, non-address text, and a send to its own
  address.

**The key in place is the only key the command spends.** `send` reads
`~/.wallet/wallet.dat` in the home of the account running it and no other file, so a key
anywhere else — one copied off another player's box, or an old one moved aside — is spent
by putting it in place under an account that holds no wallet, then `balance` and `send`. On
the box it was found on that is the owner's own account: root may `su` to it with no
password.

Everything except `init` refuses on a box with no network, in `dig`/`whois`'s wording.
`send` writes **no log line on any box** (decision 14) — the evidence of a theft is the
break-in's own trace plus the destination address in the public history.

**Key and address** (`src/core/wallet/walletKey.ts`): an address is `jsc` + the first 40 hex
of `sha256(publicKey)` (`^jsc[0-9a-f]{40}$` — the whole of "address-shaped", no checksum, no
registry, so a mistyped address of the right shape takes the coins for good). `wallet.dat` is
two labelled lines, `address:` then `key:` (64 hex); only the **key** line is ever read back,
and the address is recomputed from it, so an edited address line names nobody else's coins.
Amounts (`amount.ts`): `^[1-9][0-9]*$`, `Number.isSafeInteger` — no sign, fraction or
exponent.

## 3. core/ handlers and the adapter

- `core/wallet/handleWalletBalance.ts`, `handleWalletHistory.ts`, `handleWalletTransfer.ts` —
  the unit- and mutation-tested logic the endpoint is a shell around. `handleWalletHistory`
  holds `transferRecordSchema`, the **one** shape of a transfer both sides of the wire parse;
  it reads only the address and names the limit the endpoint's query applies.
- **A list is whole or it is not an answer**: one malformed row is the handler's 500
  (`history_lookup_failed`); one malformed record makes the adapter report a ledger that did
  not answer — a history with a hole would read as a history missing a transfer.
- `adapters/walletApi.ts` — `readBalance` and `readHistory` share one request helper (`ask`),
  so a status that is not ok is never read for an answer; `env.wallet` wires them into the
  UI (`ui/state.ts` → `readHistory({}, address)` etc.).
- `scripts/mintCoins.ts <address> <amount>` — the operator mint, through the service role;
  prints the host it is about to write to and exits 2 on a malformed address or amount before
  touching anything. Running it twice mints twice.

## 4. What the wallet costs the box it is installed on

Installing `wallet` widens a box's local attack surface like any tool: `libraryDeps.ts` maps
`wallet: ['libssl', 'libcrypt']` and `cve/localExploit.ts` maps `wallet: ['file_read']` — a
wallet's own flaw, turned against its owner with `msfconsole --local`, leaks a file. That is
a second route to a key file, beside rooting the box.

## 5. What follows, and what cannot be undone

- **Loss is final.** A deleted key, a bricked box or a cleared browser leaves the coins
  visible at their address and unspendable. The operator can mint again but never restores a
  key. `scripts/restoreSite.ts` deletes a box's journal, so a key hidden on a site the
  operator restores is gone with it.
- **Two holders of one key race**; the first transfer to land wins and nothing detects a
  copy. The remedy is the player's: a new wallet and a `send` of everything to its address.
  `init` refuses while a wallet is in place, so the new one is made under another account or
  on another box — or the old key is moved aside and back, where one wrong `mv` loses it.
- **Not tied to identity.** A player who starts over with a new identity keeps their coins if
  they kept the key text.
- **The operator is not blind.** A key file is a journal row like any other, carrying its
  writer's player key, so an operator who queries the journal for wallet files can link an
  address to the players who saved it. No player can see that; the ledger itself still never
  learns who sent a transfer (decision 17).

## 6. Proving it

- **Unit + mutation**: per slice, scoped to the files it changed; the SQL has no mutants and
  is proven by the wire-check.
- **Wire-check**: `scripts/testWallet.ts` (89 checks) against `vercel dev` + local supabase —
  the only proof of the `api/` layer's runtime correctness (column names, constraints, the
  function's words). Migrations go to `jshack-dev` then `jshack-prod` before each slice's PR
  merges.
- **Browser close-out** (2026-10-11, v0.362.0, two players): A installed `wallet` and
  `init`ed; the operator minted 500 JSC and A's `balance` read `500 JSC`; B joined A's LAN,
  rooted A's box through an out-of-date redis (`msfconsole <A> 6379`, critical/root CVE),
  read `~/.wallet/wallet.dat` and swept it; A's balance read `0 JSC` and A's history showed
  `-500 JSC  to <B>` above `+500 JSC  from coinbase` (UTC, newest first); A re-`init`ed and
  `gpg -c`'d the new key, leaving only `wallet.dat.gpg`, and B's stale copy swept nothing
  (`nothing to sweep at <A's old address>`). No defects found. That run used `wallet sweep`,
  since removed; the same theft is now `su <A's account>`, `wallet balance`, `wallet send`.
