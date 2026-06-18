import { describe, expect, it } from 'vitest';
import { accountIn } from './passwdAccount';
import { buildWorkstationBaseFsFromIdentity } from '../generation/workstationFs';
import { dir, file, PASSWD_FILE, TRAVERSABLE_DIR } from '../generation/baseFs';
import { md5 } from '../generation/md5';

/**
 * `accountIn` is the shared credential-reader behind BOTH ssh auth gates, so its
 * robustness is security-load-bearing: a malformed filesystem must yield a clean
 * null (deny), never a throw or a bogus account. These exercise its defensive
 * paths directly — the consumers always pass a well-formed generated FS, so they
 * can't reach them.
 */

const SEED = '1'.repeat(64);
const goodFs = () =>
  buildWorkstationBaseFsFromIdentity({
    ownerKeyHex: SEED,
    username: 'neo',
    rootPasswordHash: md5('rootpw'),
  });

describe('accountIn', () => {
  it('returns the hash and server-derived tier for an existing account', () => {
    expect(accountIn(goodFs(), 'root')).toEqual({ hash: md5('rootpw'), userType: 'root' });
  });

  it('returns null for an account that does not exist (unknown user → deny)', () => {
    expect(accountIn(goodFs(), 'ghost')).toBeNull();
  });

  it('returns null when /etc is missing', () => {
    expect(accountIn(dir({}, TRAVERSABLE_DIR), 'root')).toBeNull();
  });

  it('returns null when /etc is not a directory', () => {
    expect(accountIn(dir({ etc: file('x', PASSWD_FILE) }, TRAVERSABLE_DIR), 'root')).toBeNull();
  });

  it('returns null when /etc/passwd is missing', () => {
    expect(accountIn(dir({ etc: dir({}, TRAVERSABLE_DIR) }, TRAVERSABLE_DIR), 'root')).toBeNull();
  });

  it('returns null when /etc/passwd is not a file', () => {
    const malformed = dir(
      { etc: dir({ passwd: dir({}, TRAVERSABLE_DIR) }, TRAVERSABLE_DIR) },
      TRAVERSABLE_DIR,
    );
    expect(accountIn(malformed, 'root')).toBeNull();
  });
});
