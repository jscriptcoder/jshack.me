/**
 * emailit.io's view of its own mail: what a root on the box finds at the real Debian paths.
 *
 * The mail lives in the server's tables, not in files, so no root can plant, rewrite or wipe
 * anybody's mail. What the box shows is built from those tables each time it is read: one
 * mbox per account under `/var/mail`, and every account's hash in `/etc/emailit/passwd`.
 * The files are laid into the box before its journal is replayed, so a root who writes or
 * removes one changes what the next root sees, and never the mail itself.
 */

import { asctime, rfcDate } from '../generation/mailbox.js';
import { file, MAIL_SPOOL_FILE, ROOT_FILE, withFiles } from '../generation/baseFs.js';
import { EMAILIT_DOMAIN } from '../generation/fixedSites.js';
import type { Directory, FileEntry } from '../filesystem/types.js';

/** One message in an inbox, as the store keeps it. `number` is its place in the inbox and
 *  `delivered_at` the moment the server delivered it. */
export type SpoolMessage = {
  readonly number: number;
  readonly sender: string;
  readonly subject: string;
  readonly body: string;
  readonly delivered_at: string;
  readonly read: boolean;
};

/** One account, with everything in its inbox. */
export type SpoolAccount = {
  readonly handle: string;
  readonly password_md5: string;
  readonly signed_up_at: string;
  readonly messages: readonly SpoolMessage[];
};

/** One message as an mbox keeps it. An unread message has no `Status:` line, as real mail
 *  stores leave it, so a root can see what its owner has not opened. A body line that
 *  begins like a separator is quoted, or the rest of the file would split off from it. */
const mboxEntry = (to: string, message: SpoolMessage): string => {
  const delivered = Date.parse(message.delivered_at);
  return [
    `From ${message.sender} ${asctime(delivered)}`,
    `Date: ${rfcDate(delivered)}`,
    `From: <${message.sender}>`,
    `To: <${to}>`,
    `Subject: ${message.subject}`,
    ...(message.read ? ['Status: RO'] : []),
    '',
    ...message.body.split('\n').map((line) => (line.startsWith('From ') ? `>${line}` : line)),
    '',
    '',
  ].join('\n');
};

const mailbox = (account: SpoolAccount): FileEntry =>
  file(
    [...account.messages]
      .sort((first, second) => first.number - second.number)
      .map((message) => mboxEntry(`${account.handle}@${EMAILIT_DOMAIN}`, message))
      .join(''),
    MAIL_SPOOL_FILE,
  );

/** `box` with the mail laid into its `/var/mail` and `/etc/emailit`: every account gets a
 *  mailbox, empty when its inbox is, so the spool and the passwd file always name the same
 *  accounts. Pure: the box it is given is never changed. */
export const withMailSpool = (box: Directory, accounts: readonly SpoolAccount[]): Directory => {
  const bySignUp = [...accounts].sort(
    (first, second) => Date.parse(first.signed_up_at) - Date.parse(second.signed_up_at),
  );
  return withFiles(box, [
    [
      '/etc/emailit/passwd',
      file(
        bySignUp.map((account) => `${account.handle}:${account.password_md5}\n`).join(''),
        ROOT_FILE,
      ),
    ],
    ...bySignUp.map((account): [string, FileEntry] => [
      `/var/mail/${account.handle}`,
      mailbox(account),
    ]),
  ]);
};
