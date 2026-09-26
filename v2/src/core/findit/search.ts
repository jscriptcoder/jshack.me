/**
 * The search itself — a pure function from a query and the pages findit holds to the
 * pages it answers with.
 *
 * Nothing here knows where a page came from or how it was fetched; it weighs words on
 * pages. That is what lets the index be a VIEW over what the world is serving right now
 * rather than a second copy of it: whoever collects the pages hands them here, and a
 * page edited a moment ago is weighed exactly as it now reads.
 *
 * Where a word appears is the whole of the ranking. A site NAMED for what you asked is
 * a better answer than one that merely mentions it, so a title counts for more than a
 * description and a description for more than the body — and a page's author decides
 * all three by writing them, which is the only search optimisation this world has.
 */

/** A page findit can answer with: what it is called, what it says, and where to find
 *  it. `address` is what the result links to and shows — a domain for an institution. */
export type IndexedPage = {
  readonly address: string;
  readonly title: string;
  readonly description: string;
  /** The words a reader of the page sees. */
  readonly text: string;
};

/** One page of results, as many as a reader wants at once. There are about thirty
 *  places on this web, so nothing is ever pushed out of reach by the limit. */
export const MAX_RESULTS = 10;

/** What a word is worth where it appears. A name is the strongest claim a page makes
 *  about itself, and its body the weakest. */
const TITLE_SCORE = 3;
const DESCRIPTION_SCORE = 2;
const TEXT_SCORE = 1;

/** The words of a query: whatever the searcher separated with spaces, lower-cased so a
 *  match never turns on how either side was typed. */
const termsOf = (query: string): readonly string[] =>
  query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term !== '');

/**
 * What one page is worth against `terms`. Each term counts once per PLACE it appears,
 * not once per appearance: a page that says a word twenty times in its body has not
 * said anything more than a page that says it once, and counting repeats would make
 * padding the winning move.
 */
const scoreOf = (page: IndexedPage, terms: readonly string[]): number => {
  const title = page.title.toLowerCase();
  const description = page.description.toLowerCase();
  const text = page.text.toLowerCase();
  return terms.reduce(
    (total, term) =>
      total +
      (title.includes(term) ? TITLE_SCORE : 0) +
      (description.includes(term) ? DESCRIPTION_SCORE : 0) +
      (text.includes(term) ? TEXT_SCORE : 0),
    0,
  );
};

/**
 * The pages that answer `query`, best first — at most one page of them.
 *
 * Pages that answer equally well are ordered by their address, so the same query asked
 * twice gives the same answer in the same order however the pages were collected. A
 * result list that shuffled between searches would make a player doubt what they read.
 */
export const rankPages = (
  pages: readonly IndexedPage[],
  query: string,
): readonly IndexedPage[] => {
  const terms = termsOf(query);
  if (terms.length === 0) return [];
  return pages
    .map((page) => ({ page, score: scoreOf(page, terms) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) =>
      left.score === right.score
        ? left.page.address.localeCompare(right.page.address)
        : right.score - left.score,
    )
    .slice(0, MAX_RESULTS)
    .map(({ page }) => page);
};
