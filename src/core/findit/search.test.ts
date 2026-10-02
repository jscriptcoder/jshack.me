import { describe, expect, it } from 'vitest';
import { rankPages, MAX_RESULTS, type IndexedPage } from './search.js';

/**
 * What findit does with a query: it reads the pages it holds and decides which of them
 * the searcher meant. Where a word appears decides how much it counts — a site named
 * for what you asked is a better answer than one that merely mentions it — and nothing
 * but the page's own words is ever weighed.
 */

const indexedPage = (overrides: Partial<IndexedPage> = {}): IndexedPage => ({
  address: 'example.com',
  title: 'Example',
  description: 'An example site.',
  text: 'An example site.',
  ...overrides,
});

const domainsOf = (pages: readonly IndexedPage[]): readonly string[] =>
  pages.map((page) => page.address);

describe('rankPages', () => {
  it('puts a site named for what was asked above one that only mentions it', () => {
    const pages = [
      indexedPage({ address: 'mentions.com', title: 'Acme', description: 'Nothing.', text: 'We visit the university sometimes.' }),
      indexedPage({ address: 'describes.com', title: 'Acme', description: 'Near the university.', text: 'Nothing.' }),
      indexedPage({ address: 'ridgemont.edu', title: 'Ridgemont University', description: 'Nothing.', text: 'Nothing.' }),
    ];
    expect(domainsOf(rankPages(pages, 'university'))).toEqual([
      'ridgemont.edu',
      'describes.com',
      'mentions.com',
    ]);
  });

  it('counts every word of the query, so the page answering all of them wins', () => {
    const pages = [
      indexedPage({ address: 'half.com', title: 'Nothing', description: 'Nothing', text: 'coffee' }),
      indexedPage({ address: 'both.com', title: 'Nothing', description: 'Nothing', text: 'coffee and cake' }),
    ];
    expect(domainsOf(rankPages(pages, 'coffee cake'))).toEqual(['both.com', 'half.com']);
  });

  it('puts a page answering every word above one answering fewer, however prominently it says them', () => {
    const pages = [
      indexedPage({ address: 'named.com', title: 'Coffee', description: 'Coffee', text: 'Coffee' }),
      indexedPage({ address: 'both.com', title: 'Nothing', description: 'Nothing', text: 'Millbrook coffee' }),
      indexedPage({ address: 'mentions.com', title: 'Nothing', description: 'Nothing', text: 'coffee' }),
    ];
    expect(domainsOf(rankPages(pages, 'millbrook coffee'))).toEqual([
      'both.com',
      'named.com',
      'mentions.com',
    ]);
  });

  it('finds a word inside a longer one, and ignores the case either was written in', () => {
    const pages = [indexedPage({ address: 'ridgemont.edu', title: 'Ridgemont University' })];
    expect(domainsOf(rankPages(pages, 'UNIVERS'))).toEqual(['ridgemont.edu']);
  });

  it('leaves out every page the query appears nowhere on', () => {
    const pages = [
      indexedPage({ address: 'cafe.com', title: 'Coffee', description: 'Coffee', text: 'Coffee' }),
      indexedPage({ address: 'bank.com', title: 'Bank', description: 'Money', text: 'Money' }),
    ];
    expect(domainsOf(rankPages(pages, 'coffee'))).toEqual(['cafe.com']);
    expect(rankPages(pages, 'submarine')).toEqual([]);
  });

  it('answers a query with no words in it with nothing', () => {
    const pages = [indexedPage({ address: 'cafe.com', title: 'Coffee' })];
    expect(rankPages(pages, '')).toEqual([]);
    expect(rankPages(pages, '   ')).toEqual([]);
  });

  it('shows one page of results and no more, keeping the best of them', () => {
    // Every page scores the same in its body; only the one titled for the term should
    // survive being pushed off the end.
    const crowd = [...Array(MAX_RESULTS + 5).keys()].map((index) =>
      indexedPage({ address: `site-${index}.com`, title: 'Nothing', description: 'Nothing', text: 'coffee' }),
    );
    const ranked = rankPages([...crowd, indexedPage({ address: 'best.com', title: 'Coffee' })], 'coffee');
    expect(ranked).toHaveLength(MAX_RESULTS);
    expect(ranked[0]?.address).toBe('best.com');
  });

  it('orders pages that answer equally well by their address, so the answer never wavers', () => {
    const pages = [
      indexedPage({ address: 'zebra.com', title: 'Coffee' }),
      indexedPage({ address: 'apple.com', title: 'Coffee' }),
      indexedPage({ address: 'mango.com', title: 'Coffee' }),
    ];
    expect(domainsOf(rankPages(pages, 'coffee'))).toEqual(['apple.com', 'mango.com', 'zebra.com']);
    // The same query asked of the same pages in another order gives the same answer.
    expect(domainsOf(rankPages([...pages].reverse(), 'coffee'))).toEqual([
      'apple.com',
      'mango.com',
      'zebra.com',
    ]);
  });

  it('weighs a word once per place it appears, however many times it is repeated there', () => {
    const pages = [
      indexedPage({ address: 'repeats.com', title: 'Nothing', description: 'Nothing', text: 'coffee coffee coffee coffee' }),
      indexedPage({ address: 'named.com', title: 'Coffee', description: 'Nothing', text: 'Nothing' }),
    ];
    expect(domainsOf(rankPages(pages, 'coffee'))).toEqual(['named.com', 'repeats.com']);
  });

  it('finds a word written with an accent when it is asked without one, weighed where it appears', () => {
    const pages = [
      indexedPage({
        address: 'body.com',
        title: 'Nothing',
        description: 'Nothing',
        text: 'A small café.',
      }),
      indexedPage({
        address: 'named.com',
        title: 'Café Rouge',
        description: 'Nothing',
        text: 'Nothing',
      }),
      indexedPage({
        address: 'described.com',
        title: 'Nothing',
        description: 'The CAFÉ by the river.',
        text: 'Nothing',
      }),
    ];
    expect(domainsOf(rankPages(pages, 'cafe'))).toEqual(['named.com', 'described.com', 'body.com']);
  });

  it('finds a word written without an accent when it is asked with one, weighed where it appears', () => {
    const pages = [
      indexedPage({
        address: 'body.com',
        title: 'Nothing',
        description: 'Nothing',
        text: 'A small cafe.',
      }),
      indexedPage({
        address: 'named.com',
        title: 'Cafe Rouge',
        description: 'Nothing',
        text: 'Nothing',
      }),
      indexedPage({
        address: 'described.com',
        title: 'Nothing',
        description: 'The CAFE by the river.',
        text: 'Nothing',
      }),
    ];
    expect(domainsOf(rankPages(pages, 'Café'))).toEqual(['named.com', 'described.com', 'body.com']);
  });

  it('counts a word answered however either side wrote its accents towards answering every word', () => {
    const pages = [
      indexedPage({
        address: 'bakery.com',
        title: 'Millbrook Bakery',
        description: 'Millbrook',
        text: 'Millbrook',
      }),
      indexedPage({
        address: 'cafe.com',
        title: 'Nothing',
        description: 'Nothing',
        text: 'The café in Millbrook.',
      }),
    ];
    expect(domainsOf(rankPages(pages, 'millbrook cafe'))).toEqual(['cafe.com', 'bakery.com']);
  });

  it('shows a page found by a word it accents exactly as the page writes it', () => {
    const page = indexedPage({
      address: 'named.com',
      title: 'Café Rouge',
      description: 'Un café.',
    });
    expect(rankPages([page], 'cafe')).toEqual([page]);
  });
});
