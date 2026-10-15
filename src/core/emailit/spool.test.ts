import { describe, expect, it } from 'vitest';
import { withMailSpool, type SpoolAccount, type SpoolMessage } from './spool.js';
import {
  dir,
  file,
  MAIL_SPOOL_DIR,
  MAIL_SPOOL_FILE,
  PASSWD_FILE,
  ROOT_DIR,
  ROOT_FILE,
  TRAVERSABLE_DIR,
} from '../generation/baseFs.js';
import type { Directory, FileNode } from '../filesystem/types.js';

/**
 * emailit.io's view of the mail, as root finds it on the box: one mbox per account under
 * `/var/mail` and every account's hash in `/etc/emailit/passwd`, built from the store's
 * rows. The rows are made here; the files are the behaviour.
 */

const message = (overrides: Partial<SpoolMessage> = {}): SpoolMessage => ({
  number: 1,
  sender: 'noreply@emailit.io',
  subject: 'Welcome to emailit.io',
  body: 'Welcome aboard.',
  delivered_at: '2026-10-14T09:12:03.456+00:00',
  read: true,
  ...overrides,
});

const account = (overrides: Partial<SpoolAccount> = {}): SpoolAccount => ({
  handle: 'neo',
  password_md5: '5f4dcc3b5aa765d61d8327deb882cf99',
  signed_up_at: '2026-10-14T09:12:03.000+00:00',
  messages: [message()],
  ...overrides,
});

/** The box as emailit.io's is generated: the two directories there, empty, beside the
 *  box's own `/etc/passwd`. */
const box = (): Directory =>
  dir(
    {
      etc: dir(
        {
          passwd: file('root:x:0:0:root:/root:/bin/bash\n', PASSWD_FILE),
          emailit: dir({}, ROOT_DIR),
        },
        TRAVERSABLE_DIR,
      ),
      var: dir({ mail: dir({}, MAIL_SPOOL_DIR) }, TRAVERSABLE_DIR),
    },
    TRAVERSABLE_DIR,
  );

const nodeAt = (tree: Directory, path: string): FileNode | undefined =>
  path
    .split('/')
    .filter((segment) => segment !== '')
    .reduce<FileNode | undefined>(
      (node, name) => (node?.kind === 'directory' ? node.entries.get(name) : undefined),
      tree,
    );

const contentAt = (tree: Directory, path: string): string | undefined => {
  const node = nodeAt(tree, path);
  return node?.kind === 'file' ? node.content : undefined;
};

describe('emailit.io /etc/emailit/passwd', () => {
  it('holds one handle:hash line per account, in sign-up order', () => {
    const tree = withMailSpool(box(), [
      account({
        handle: 'trin',
        password_md5: 'b'.repeat(32),
        signed_up_at: '2026-10-14T10:00:00.000+00:00',
      }),
      account({
        handle: 'neo',
        password_md5: 'a'.repeat(32),
        signed_up_at: '2026-10-14T09:00:00.000+00:00',
      }),
      account({
        handle: 'morph',
        password_md5: 'c'.repeat(32),
        signed_up_at: '2026-10-14T11:00:00.000+00:00',
      }),
    ]);

    expect(contentAt(tree, '/etc/emailit/passwd')).toBe(
      `neo:${'a'.repeat(32)}\ntrin:${'b'.repeat(32)}\nmorph:${'c'.repeat(32)}\n`,
    );
  });

  it('orders by the moment of sign-up, not by how the time is written', () => {
    const tree = withMailSpool(box(), [
      account({ handle: 'late', signed_up_at: '2026-10-14T10:00:00+00:00' }),
      account({ handle: 'early', signed_up_at: '2026-10-14T11:30:00+02:00' }),
    ]);

    expect(contentAt(tree, '/etc/emailit/passwd')).toMatch(/^early:.*\nlate:/);
  });

  it('is root-only and owned by root', () => {
    const node = nodeAt(withMailSpool(box(), [account()]), '/etc/emailit/passwd');

    expect(node).toMatchObject({ kind: 'file', owner: 'root', perms: ROOT_FILE });
  });

  it('is empty when there are no accounts', () => {
    expect(contentAt(withMailSpool(box(), []), '/etc/emailit/passwd')).toBe('');
  });
});

describe('emailit.io /var/mail/<handle>', () => {
  it('gives every account a mailbox, empty when its inbox is', () => {
    const tree = withMailSpool(box(), [
      account({ handle: 'neo' }),
      account({ handle: 'trin', messages: [] }),
    ]);
    const spool = nodeAt(tree, '/var/mail');

    expect(spool?.kind === 'directory' ? [...spool.entries.keys()] : []).toEqual(['neo', 'trin']);
    expect(contentAt(tree, '/var/mail/trin')).toBe('');
  });

  it('writes a read message as an mbox entry marked read', () => {
    const tree = withMailSpool(box(), [
      account({
        messages: [message({ body: 'Welcome aboard.\nYour address is neo@emailit.io.' })],
      }),
    ]);

    expect(contentAt(tree, '/var/mail/neo')).toBe(
      [
        'From noreply@emailit.io Wed Oct 14 09:12:03 2026',
        'Date: Wed, 14 Oct 2026 09:12:03 +0000',
        'From: <noreply@emailit.io>',
        'To: <neo@emailit.io>',
        'Subject: Welcome to emailit.io',
        'Status: RO',
        '',
        'Welcome aboard.',
        'Your address is neo@emailit.io.',
        '',
        '',
      ].join('\n'),
    );
  });

  it('gives an unread message no Status line', () => {
    const tree = withMailSpool(box(), [account({ messages: [message({ read: false })] })]);

    expect(contentAt(tree, '/var/mail/neo')).toBe(
      [
        'From noreply@emailit.io Wed Oct 14 09:12:03 2026',
        'Date: Wed, 14 Oct 2026 09:12:03 +0000',
        'From: <noreply@emailit.io>',
        'To: <neo@emailit.io>',
        'Subject: Welcome to emailit.io',
        '',
        'Welcome aboard.',
        '',
        '',
      ].join('\n'),
    );
  });

  it('keeps messages oldest first, each after a blank line', () => {
    const tree = withMailSpool(box(), [
      account({
        messages: [
          message({
            number: 7,
            sender: 'trin@emailit.io',
            subject: 'second',
            body: 'b',
            read: false,
          }),
          message({ number: 2, sender: 'morph@emailit.io', subject: 'first', body: 'a' }),
        ],
      }),
    ]);
    const content = contentAt(tree, '/var/mail/neo') ?? '';

    expect(content.split('\n').filter((line) => line.startsWith('From '))).toEqual([
      'From morph@emailit.io Wed Oct 14 09:12:03 2026',
      'From trin@emailit.io Wed Oct 14 09:12:03 2026',
    ]);
    expect(content).toContain('\na\n\nFrom trin@emailit.io ');
  });

  it('quotes a body line that would read as a separator', () => {
    const tree = withMailSpool(box(), [
      account({ messages: [message({ body: 'From the top.\nFromage is cheese.\n From here.' })] }),
    ]);

    expect(contentAt(tree, '/var/mail/neo')).toContain(
      '\n>From the top.\nFromage is cheese.\n From here.\n',
    );
  });

  it('dates a message by its delivery, in UTC', () => {
    const tree = withMailSpool(box(), [
      account({ messages: [message({ delivered_at: '2026-10-15T01:02:03+02:00' })] }),
    ]);
    const content = contentAt(tree, '/var/mail/neo') ?? '';

    expect(content).toContain('From noreply@emailit.io Wed Oct 14 23:02:03 2026\n');
    expect(content).toContain('\nDate: Wed, 14 Oct 2026 23:02:03 +0000\n');
  });

  it('is root-only and owned by root', () => {
    const node = nodeAt(withMailSpool(box(), [account()]), '/var/mail/neo');

    expect(node).toMatchObject({ kind: 'file', owner: 'root', perms: MAIL_SPOOL_FILE });
  });
});

describe('emailit.io the box around the view', () => {
  it('keeps the directories it was given and everything else on the box', () => {
    const tree = withMailSpool(box(), [account()]);

    expect(nodeAt(tree, '/var/mail')).toMatchObject({ kind: 'directory', perms: MAIL_SPOOL_DIR });
    expect(nodeAt(tree, '/etc/emailit')).toMatchObject({ kind: 'directory', perms: ROOT_DIR });
    expect(contentAt(tree, '/etc/passwd')).toBe('root:x:0:0:root:/root:/bin/bash\n');
  });

  it('leaves the box it was given as it was', () => {
    const before = box();
    withMailSpool(before, [account()]);

    expect(nodeAt(before, '/var/mail')).toMatchObject({ kind: 'directory', entries: new Map() });
    expect(nodeAt(before, '/etc/emailit/passwd')).toBeUndefined();
  });
});
