import { describe, expect, it } from 'vitest';
import { admitToDoor, ftpLanding } from './doorAdmission.js';
import { dir, file, PASSWD_FILE, SERVICE_CONFIG_FILE, TRAVERSABLE_DIR } from '../generation/baseFs.js';
import { md5 } from '../generation/md5.js';
import type { Directory } from '../filesystem/types.js';

const ROOT_PASSWORD = 'correct-horse';
const GUEST_PASSWORD = 'hunter2';

const PASSWD =
  `root:${md5(ROOT_PASSWORD)}:0:0:root:/root:/bin/bash\n` +
  `guest:${md5(GUEST_PASSWORD)}:1001:1001:guest:/home/guest:/bin/bash\n`;

/** A box with the given accounts and, when named, the given `/etc/vsftpd.conf`. */
const boxWith = (over: { readonly config?: string; readonly passwd?: string } = {}): Directory =>
  dir(
    {
      etc: dir(
        {
          passwd: file(over.passwd ?? PASSWD, PASSWD_FILE),
          ...(over.config === undefined
            ? {}
            : { 'vsftpd.conf': file(over.config, SERVICE_CONFIG_FILE) }),
        },
        TRAVERSABLE_DIR,
      ),
    },
    TRAVERSABLE_DIR,
  );

const OPEN = 'listen=YES\nanonymous_enable=YES\nlocal_enable=YES\n';

describe('who a password door lets in', () => {
  it('lets a named account in on its own password, at its own tier', () => {
    expect(admitToDoor('ssh', boxWith(), 'root', ROOT_PASSWORD)).toBe('root');
    expect(admitToDoor('ftp', boxWith(), 'guest', GUEST_PASSWORD)).toBe('guest');
  });

  it('refuses a wrong password and an unknown account alike', () => {
    expect(admitToDoor('ssh', boxWith(), 'root', 'nope')).toBeNull();
    expect(admitToDoor('ssh', boxWith(), 'nobody', ROOT_PASSWORD)).toBeNull();
  });

  it('never matches a passwordless account, since no typed password hashes to empty', () => {
    const passwd = 'alice::1000:1000:alice:/home/alice:/bin/bash\n';

    expect(admitToDoor('ssh', boxWith({ passwd }), 'alice', '')).toBeNull();
  });
});

describe('anonymous at the ftp door', () => {
  it.each(['', 'anything', ROOT_PASSWORD])(
    'lets anonymous in at guest tier on a box saying so, whatever the password (%j)',
    (password) => {
      expect(admitToDoor('ftp', boxWith({ config: OPEN }), 'anonymous', password)).toBe('guest');
    },
  );

  it('still checks every other name against /etc/passwd on that box', () => {
    const box = boxWith({ config: OPEN });

    expect(admitToDoor('ftp', box, 'root', ROOT_PASSWORD)).toBe('root');
    expect(admitToDoor('ftp', box, 'root', 'nope')).toBeNull();
    expect(admitToDoor('ftp', box, 'nobody', 'anything')).toBeNull();
    expect(admitToDoor('ftp', box, 'Anonymous', 'anything')).toBeNull();
  });

  it.each(['ssh', 'scp'] as const)('is no login at the %s door, on any box', (door) => {
    expect(admitToDoor(door, boxWith({ config: OPEN }), 'anonymous', 'anything')).toBeNull();
  });

  it.each([
    ['carrying no config', undefined],
    ['set to NO', 'anonymous_enable=NO\n'],
    ['commented out', '#anonymous_enable=YES\n'],
    ['part of another setting', 'no_anonymous_enable=YES\n'],
    ['with a value that only starts YES', 'anonymous_enable=YESTERDAY\n'],
  ])('refuses anonymous on a box %s', (_label, config) => {
    const box = config === undefined ? boxWith() : boxWith({ config });

    expect(admitToDoor('ftp', box, 'anonymous', 'anything')).toBeNull();
  });

  it('finds the setting on any line of the config', () => {
    const box = boxWith({ config: 'anonymous_enable=YES\nlisten=YES' });
    const last = boxWith({ config: 'listen=YES\nanonymous_enable=YES' });

    expect(admitToDoor('ftp', box, 'anonymous', '')).toBe('guest');
    expect(admitToDoor('ftp', last, 'anonymous', '')).toBe('guest');
  });

  it('reads a config a root has turned into a directory as no config at all', () => {
    const box = dir(
      { etc: dir({ 'vsftpd.conf': dir({}, TRAVERSABLE_DIR) }, TRAVERSABLE_DIR) },
      TRAVERSABLE_DIR,
    );

    expect(admitToDoor('ftp', box, 'anonymous', '')).toBeNull();
  });

  it('refuses, rather than crashes, on a box whose root has removed or replaced /etc', () => {
    const noEtc = dir({}, TRAVERSABLE_DIR);
    const etcAsFile = dir({ etc: file('', SERVICE_CONFIG_FILE) }, TRAVERSABLE_DIR);

    expect(admitToDoor('ftp', noEtc, 'anonymous', '')).toBeNull();
    expect(admitToDoor('ftp', etcAsFile, 'anonymous', '')).toBeNull();
  });

  it('holds an account named anonymous to its password while the box refuses the login', () => {
    const passwd = `anonymous:${md5('mine')}:1002:1002:a:/home/anonymous:/bin/bash\n`;

    expect(admitToDoor('ftp', boxWith({ passwd }), 'anonymous', 'mine')).toBe('user');
    expect(admitToDoor('ftp', boxWith({ passwd }), 'anonymous', 'nope')).toBeNull();
  });

  it('keeps an account named anonymous at guest tier while the box lets the login in', () => {
    const passwd = `anonymous:${md5('mine')}:0:0:a:/root:/bin/bash\n`;

    expect(admitToDoor('ftp', boxWith({ config: OPEN, passwd }), 'anonymous', 'mine')).toBe('guest');
  });
});

describe('where an ftp session lands', () => {
  it('lands anonymous in the public directory, which is no account home', () => {
    expect(ftpLanding({ username: 'anonymous', userType: 'guest' })).toBe('/srv/ftp');
  });

  it('lands every other account in its own home', () => {
    expect(ftpLanding({ username: 'guest', userType: 'guest' })).toBe('/home/guest');
    expect(ftpLanding({ username: 'root', userType: 'root' })).toBe('/root');
  });
});
