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

/** The front page as a reader sees it: the text, with the markup and its entities gone. */
const frontPageText = (): string => {
  const path = resolveWebPath('/');
  if (path === null) throw new Error('the front page has no path');
  const read = createFsView(emailitBox(), { userType: 'root' }).read(path);
  if (!read.ok) throw new Error('emailit.io serves no front page');
  return new DOMParser().parseFromString(read.content, 'text/html').body.textContent ?? '';
};

describe('the front page of emailit.io', () => {
  it('shows the command that signs a reader up, ready to fill in', () => {
    expect(frontPageText()).toContain(
      'curl -d "handle=<handle>&password=<password>" http://emailit.io/signup',
    );
  });

  it('says where the mail program comes from', () => {
    expect(frontPageText()).toContain('apt install mailutils');
  });

  it('warns the person at the keyboard off their real passwords', () => {
    expect(frontPageText()).toContain("Don't use a password you use anywhere outside this game.");
  });
});
