import { describe, expect, it } from 'vitest';
import { HIREME_FRONT_PAGE, thanksPage } from './pages.js';

/**
 * hireme.io's front page, the file a fresh box serves at `/`: what a reader in lynx or
 * curl finds there before applying.
 */

const document = () => new DOMParser().parseFromString(HIREME_FRONT_PAGE, 'text/html');

describe("hireme.io's front page", () => {
  it('is titled and described for the search engine', () => {
    const page = document();

    expect(page.title).toBe('hireme.io - contract work');
    expect(page.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      'Freelance contract work for independent IT and security people. Apply with your emailit.io address.',
    );
  });

  it('says what the agency offers', () => {
    const page = document();

    expect(page.querySelector('h1')?.textContent).toBe('hireme.io');
    expect(page.body.textContent?.replace(/\s+/g, ' ')).toContain(
      'Freelance contracts for independent IT and security people. Apply with your emailit.io address and we will send you your contractor board.',
    );
  });

  it('holds a form that posts an email address to /apply', () => {
    const form = document().querySelector('form');

    expect(form?.getAttribute('action')).toBe('/apply');
    expect(form?.getAttribute('method')).toBe('post');
    expect(form?.querySelector('input[name="email"]')?.getAttribute('value')).toBe('');
    expect(form?.querySelector('input[type="submit"]')?.getAttribute('value')).toBe('Apply');
  });

  it('shows how to apply from a terminal', () => {
    expect(document().body.textContent).toContain('Or from a terminal:');
    expect(document().querySelector('pre')?.textContent).toContain(
      '$ curl -d "email=neo@emailit.io" http://hireme.io/apply',
    );
  });

  it('says nothing is wrong on a page nobody has submitted yet', () => {
    expect(document().querySelector('[role="alert"]')).toBeNull();
  });
});

describe('the page an application that was mailed answers with', () => {
  const thanks = () =>
    new DOMParser().parseFromString(thanksPage('neo', 'neo@emailit.io'), 'text/html');

  it('is titled and headed as thanks', () => {
    const page = thanks();

    expect(page.title).toBe('Thanks for applying');
    expect(page.querySelector('h1')?.textContent).toBe('Thanks for applying');
  });

  // Only the front page describes the site to the search engine; a page reached by
  // applying is nobody's listing.
  it('carries no description of its own', () => {
    expect(thanks().querySelector('meta[name="description"]')).toBeNull();
  });
});
