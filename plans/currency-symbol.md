# Plan: JSC gets a currency symbol

**Status:** Grilled 2026-11-06. Slice not yet planned. Nothing is built.

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
- `src/core/hireme/contractBoard.ts` — `payOf`, every board line and mail that quotes a pay.
- `src/core/missions/hiremeOrders.ts` — the briefing's `Pay:` line.
- `src/core/rideit/pages.ts` — the fare, and `<paid> of <fare>`.
- `scripts/mintCoins.ts` — the operator's console lines (assumed in scope; operator-only).

The wire-checks that read these lines (`testWallet`, `testChainit`, `testMissionBoard`,
`testMissionPay`, `testTravel`) move with them.
