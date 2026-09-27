import { describe, expect, it } from 'vitest';
import { accountIn, accountsIn, withAccountHash } from './passwdAccount';
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

const withoutPasswd = () => dir({ etc: dir({}, TRAVERSABLE_DIR) }, TRAVERSABLE_DIR);

/** A passwd file holding exactly these rows, newline-terminated as the generators write it. */
const passwdOf = (rows: readonly string[]) =>
  dir(
    { etc: dir({ passwd: file(`${rows.join('\n')}\n`, PASSWD_FILE) }, TRAVERSABLE_DIR) },
    TRAVERSABLE_DIR,
  );

describe('accountsIn', () => {
  it('names nobody on a box carrying no passwd file', () => {
    // An exploit that lands on nobody has to refuse, and that rests on this being empty
    // rather than one account with a nonsense name the box would not recognise.
    expect(accountsIn(withoutPasswd())).toEqual([]);
  });
});

/**
 * The write half of the same knowledge: a rewrite that assembled a row its own way could
 * put the hash in a field `accountIn` never reads, and the credential would quietly stop
 * being the one that opens the door.
 */
describe('withAccountHash', () => {
  it('replaces one account’s hash and leaves the rest of its row, and every other row, alone', () => {
    const tree = passwdOf([
      'root:oldroot:0:0:root:/root:/bin/bash',
      'guest:oldguest:1001:1001::/home/guest:/bin/bash',
    ]);

    expect(withAccountHash(tree, 'guest', 'newhash')).toBe(
      'root:oldroot:0:0:root:/root:/bin/bash\nguest:newhash:1001:1001::/home/guest:/bin/bash\n',
    );
  });

  it('rewrites a row that carries nothing but a name and a hash', () => {
    // A hand-edited passwd is something a rooted player can leave behind, and that account
    // still has to be resettable: the guard exists for a row with no hash FIELD at all, not
    // for a short one.
    expect(withAccountHash(passwdOf(['guest:oldguest']), 'guest', 'newhash')).toBe('guest:newhash\n');
  });

  it('has nothing to rewrite on a box carrying no passwd file', () => {
    // Unreachable through the exploit handler — it refuses earlier when the box names no
    // account — so the behaviour is pinned here rather than left to chance.
    expect(withAccountHash(withoutPasswd(), 'guest', 'newhash')).toBe('');
  });
});
