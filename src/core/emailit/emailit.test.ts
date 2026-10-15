import { describe, expect, it } from 'vitest';
import { materializeApGatewayFs } from '../network/materializeRouterFs.js';
import { createFsView } from '../filesystem/fsView.js';
import { resolveWebPath } from '../network/http.js';
import { EMAILIT_NETWORK } from '../generation/fixedSites.js';
import type { Directory } from '../filesystem/types.js';

/**
 * emailit.io is where an email address comes from. Its front page is read here off the box
 * the way a visitor's browser gets it: the page its web server serves.
 */

const emailitBox = (): Directory => materializeApGatewayFs({ essid: EMAILIT_NETWORK }, []);

/** The page emailit.io's web server serves at `requestPath`. */
const served = (requestPath: string): string => {
  const path = resolveWebPath(requestPath);
  if (path === null) throw new Error(`${requestPath} has no path`);
  const read = createFsView(emailitBox(), { userType: 'root' }).read(path);
  if (!read.ok) throw new Error(`emailit.io serves nothing at ${requestPath}`);
  return read.content;
};

/** The front page as served, parsed the way a browser reads it. */
const frontPage = (): Document => new DOMParser().parseFromString(served('/'), 'text/html');

/** The front page as a reader sees it: the text, with the markup and its entities gone. */
const frontPageText = (): string => frontPage().body.textContent ?? '';

describe('the front page of emailit.io', () => {
  it('shows the command that signs a reader up, ready to fill in', () => {
    expect(frontPageText()).toContain(
      'curl -d "handle=<handle>&password=<password>" http://emailit.io/signup',
    );
  });

  it('says where the mail program comes from', () => {
    expect(frontPageText()).toContain('apt install mailutils');
  });

  it('opens with what the site is, and no error above it until a sign-up is refused', () => {
    const opening = frontPageText().replace(/\s+/g, ' ').trim();

    expect(opening).toMatch(/^emailit\.io Free email for everybody/);
    expect(frontPage().querySelector('strong')).toBeNull();
  });

  it('carries the sign-up form: a handle, a password and a button, posted to /signup', () => {
    const form = frontPage().querySelector('form');

    expect(form?.getAttribute('action')).toBe('/signup');
    expect(form?.getAttribute('method')).toBe('post');
    expect(form?.querySelector('input[name="handle"]')?.getAttribute('value')).toBe('');
    expect(form?.querySelector('input[name="password"]')?.getAttribute('type')).toBe('password');
    expect(form?.querySelector('input[type="submit"]')?.getAttribute('value')).toBe('Sign up');
  });

  it('offers the form before the way to sign up from a terminal', () => {
    const text = frontPageText();

    expect(text.indexOf('Handle')).toBeGreaterThan(-1);
    expect(text.indexOf('Handle')).toBeLessThan(text.indexOf('Or from a terminal'));
    expect(text.indexOf('Or from a terminal')).toBeLessThan(text.indexOf('curl -d'));
  });

  // Going back to a page a sign-up was posted from asks for /signup again, and asking
  // must not post: it gets the form, ready to be filled in afresh.
  it('serves the front page, form and all, at /signup', () => {
    expect(served('/signup')).toBe(served('/'));
  });

  it('warns the person at the keyboard off their real passwords', () => {
    expect(frontPageText()).toContain("Don't use a password you use anywhere outside this game.");
  });
});
