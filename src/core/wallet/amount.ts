/** A count of coins as it is typed: digits only, never starting with a zero, so
 *  there is one way to write each amount and no sign, fraction or exponent. */
const AMOUNT = /^[1-9][0-9]*$/;

/** The number of coins `text` asks for, or `null` when it is not an amount: at
 *  least one, and no larger than the ledger can hold as an exact number. Nothing
 *  is repaired here: a near miss is refused, because whatever this lets through
 *  is minted or sent as it stands. */
export const readAmount = (text: string): number | null => {
  if (!AMOUNT.test(text)) return null;
  const amount = Number(text);
  return Number.isSafeInteger(amount) ? amount : null;
};

/** An amount of coins as every screen prints it: `§1,650`. The sign is the coin's,
 *  chosen because the game's terminal fonts draw it beside their own digits; the
 *  comma groups thousands so a pay and a balance read alike. Only output takes this
 *  form; what a player types is still the bare digits `readAmount` reads. */
export const writeAmount = (amount: number): string => `§${amount.toLocaleString('en-US')}`;
