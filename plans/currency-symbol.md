# Plan: JSC gets a currency symbol

**Status:** Grilled 2026-11-06. Slice planned 2026-11-06. Nothing is built.

Every amount of JSC the game prints today reads `<n> JSC`. The owner wants a currency symbol in its
place, the way `$1,650` reads, so an amount looks like money at a glance. One slice. As-built context:
[`docs/wallet-architecture.md`](../docs/wallet-architecture.md).

---

## Grill record

1. **The symbol is `§` (U+00A7, section sign) (2026-11-06).** It sits in Latin-1, so it is drawn by
   the game's own fonts on every theme: Share Tech Mono (the default neon look loads only its latin
   subset, `U+0000-00FF` plus a few code points) and Courier New (the classic looks). Checked against
   the shipped `share-tech-mono-latin-400-normal` woff and `C:\Windows\Fonts\cour.ttf`. It resembles
   `$`, which the owner wants: it reads as money at once. Rejected: `Ɉ` (J with stroke; not in
   Share Tech Mono, so it fell back to another face and read as a `3`); `◊`, `♦`, `Ħ`, `Ŧ`, `Ɇ` (none
   is in Share Tech Mono's subset, so each is drawn by a fallback face beside the game font's digits);
   `¤`, `¢` and the thorn `Þ`/`þ` (in the font, not chosen). Real currency signs (`$ € £ ¥ ₹ ₿`) and
   well-known coin signs (`Ξ Ł Đ Ƀ`) were ruled out first, because a player would read them as that
   money.

2. **The symbol goes before the amount, with no space: `§1,650` (2026-11-06).** It reads like
   `$1,650`. A history line signs it outside the symbol, `+§1,650` and `-§25`. Rejected: after the
   amount with a space (`1,650 §`); the symbol and the ticker together (`§1,650 JSC`, longer lines,
   nothing gained).

3. **Every printed amount takes a thousands comma (2026-11-06).** One formatter for every `§` amount:
   `§1,650`, `§25`, `§1,000,000`. Today the wallet, chainit.io and rideit.io print the raw number
   (`1650`) while hireme's `payOf` prints `1,350`; the slice ends that split. Rejected: raw everywhere
   (drops hireme's comma); leaving each place's format as it is.

4. **Defaults, confirmed by not being objected to (2026-11-06):**
   - **Input does not change.** `wallet send <address> <amount>` still takes a whole number written
     in digits, as `man wallet` says. Nobody has to type `§`.
   - **JSC stays the coin's name.** Where the word names the coin rather than an amount, it stays:
     "the JSC block explorer", "Not a JSC address", "not enough JSC", "Nobody holds any JSC", and the
     `man wallet` prose.
   - **`/etc/hireme/contracts` keeps the bare number.** `contractsList` prints the pay as a bare
     number on purpose, so every line splits into four fields.
   - **Mail already sent keeps its words.** A briefing already in somebody's inbox is a stored row
     and still says `JSC`; only new mail carries `§`. No backward-compatibility burden before launch.

## Where an amount is printed (found 2026-11-06)

- `src/core/commands/wallet.ts` — `balance` (`<address>  <n> JSC`) and `send` (`sent <n> JSC to …`).
- `src/core/wallet/historyLine.ts` — `wallet history`, and chainit.io's address page through it.
- `src/core/chainit/pages.ts` — the address balance, the latest-transfers line, the richest list.
- `src/core/hireme/contractBoard.ts` — `payOf`, every board line that quotes a pay, and the client's
  "Key received. … sent to …" reply through `src/core/missions/clientMail.ts`.
- `src/core/missions/hiremeOrders.ts` — the briefing's `Pay:` line.
- `src/core/rideit/pages.ts` — the fare, and `<paid> of <fare>`.
- `scripts/mintCoins.ts` — the operator's console lines (assumed in scope; operator-only).

The wire-checks that read these lines (`testWallet`, `testChainit`, `testMissionBoard`,
`testMissionPay`, `testTravel`) move with them.

---

## Slice 1 — every amount reads `§1,650` (v0.446.0)

One PR, branch `feat/currency-symbol`. No `api/` handler changes shape, but chainit.io's pages and
the client's reply mail are rendered on the server, so the wire-checks run before merge.

**Acceptance criteria**

- `wallet balance` prints `<address>  §1,675`; an address nothing was sent to prints `§0`.
- `wallet send` prints `sent §25 to <address>`; its input is unchanged (a typed `§25` is still
  refused as not an amount).
- `wallet history` and chainit.io's address page print `+§1,650  from coinbase` and
  `-§25  to <address>`.
- chainit.io's `/recent` prints `§500  <from> -> <to>`; `/rich` prints ` 1  <address>  §12,000`.
- hireme's board and current-contract lines quote `§1,350`; a briefing's `Pay:` line reads
  `§1,350` (raw `1350` today); the client's reply reads `Key received. §1,350 sent to <wallet>.`
- rideit.io reads `One fare to anywhere: §25.` and `§10 of §25`.
- `scripts/mintCoins.ts` prints `Minting §500 to …` and `<address>  §500`.
- Every amount with four or more digits carries a thousands comma.
- Unchanged: `/etc/hireme/contracts` (bare number), every prose use of JSC as the coin's name, the
  `man wallet` text.

**Shape**

- One formatter, `writeAmount(amount: number): string`, in `src/core/wallet/amount.ts` beside its
  inverse `readAmount`: `§` then `toLocaleString('en-US')`, the grouping `payOf` already uses.
  `payOf` goes; its callers take `writeAmount`. Every site in "Where an amount is printed" calls it.
  The sign in a history line stays outside it (`+${writeAmount(amount)}`).

**TDD order (RED first, each at its public surface)**

1. `writeAmount`: `0`, `25`, `1650`, `1000000`, in a new `amount.test.ts`.
2. `wallet balance` and `send` (`commands/wallet.test.ts`, then `ui/state.test.ts`'s wallet lines).
3. `historyLine.test.ts`, which carries both `wallet history` and chainit's address page.
4. chainit.io: `chainit/pages.test.ts` and the served pages in `network/resolveHttpFetch.test.ts`.
5. hireme: `contractBoard.test.ts`, `missions/hiremeOrders.test.ts`, `missions/clientMail.test.ts`.
6. rideit.io: `rideit/pages.test.ts` (and `board.test.ts` if it asserts the fare's words).
7. `scripts/mintCoins.ts`: no unit seam; proven by the operator run in the wire-checks.

**Gates**

- `npm run typecheck`, `npm run lint`, the full suite, `npm run build` with `checkBudgets`. The bundle
  has 14 B of headroom at v0.445.0; if the build goes over, raise `BUNDLE_CEILING_BYTES` by what it
  needs (owner, 2026-11-04: size is not a problem).
- Wire-checks against `vercel dev` + local supabase: `testWallet`, `testChainit`, `testMissionBoard`,
  `testMissionPay`, `testTravel`, updated to the new lines.
- Mutation gate on `src/core/wallet/amount.ts` and the changed lines.
- Version bump to v0.446.0 in `package.json` and `package-lock.json`.

**Docs**

- Printed-format examples move to `§`: `wallet-architecture.md` (history line, the chainit page
  table), `missions-architecture.md` (the offer's pay, the client's reply table). Records of past
  runs keep the words they printed then.
- `project-status.md` gains the shipped item; this plan is retired on close-out.

**Close-out**

One browser run in the default neon theme: `wallet balance`, `wallet history`, `lynx` chainit.io and
a hireme board, checking `§` is drawn by the game font beside the digits. Then a valleynews `/dev`
note if the owner wants one.
