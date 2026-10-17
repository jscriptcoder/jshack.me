/**
 * Every uncrackable word that turns up in a built file. The game ships that pool as
 * md5s only (`scripts/encode.ts`), so a player reading the bundle has hashes to crack
 * rather than an answer key; `scripts/checkSecrets.ts` runs this over `dist/` after
 * every build and fails it on any match.
 *
 * A plain substring match: a minifier joins strings as it likes, so a word is a leak
 * wherever it sits, not only between quotes.
 */

export type BuiltFile = { readonly path: string; readonly content: string };

export type SecretLeak = { readonly word: string; readonly path: string };

export const findSecretLeaks = (
  words: readonly string[],
  files: readonly BuiltFile[],
): readonly SecretLeak[] =>
  files.flatMap(({ path, content }) =>
    words.filter((word) => content.includes(word)).map((word) => ({ word, path })),
  );
