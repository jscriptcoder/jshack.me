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
  /** The one file the message carries, by name and content, or null for both. */
  readonly attachment_name: string | null;
  readonly attachment_content: string | null;
};

/** One account, with everything in its inbox. */
export type SpoolAccount = {
  readonly handle: string;
  readonly password_md5: string;
  readonly signed_up_at: string;
  readonly messages: readonly SpoolMessage[];
};

/** Text as an mbox keeps it: a line that begins like a separator is quoted, or the rest of
 *  the file would split off from it. */
const mboxLines = (text: string): readonly string[] =>
  text.split('\n').map((line) => (line.startsWith('From ') ? `>${line}` : line));

/** A message as MIME writes it: no extra headers and the body alone, or, for a message that
 *  carries a file, the body and the file as two parts. The file is laid in raw, not base64:
 *  the game has no `base64 -d`, so a root here sees what everybody was sent but cannot
 *  cleanly carve it back out byte for byte, as this view lets a root read and forge, never
 *  take. */
const mimeOf = (
  message: SpoolMessage,
): { readonly headers: readonly string[]; readonly content: readonly string[] } => {
  const { attachment_name: name, attachment_content: content } = message;
  if (name === null || content === null) return { headers: [], content: mboxLines(message.body) };
  const boundary = `emailit-${message.number}`;
  return {
    headers: ['MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${boundary}"`],
    content: [
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      ...mboxLines(message.body),
      `--${boundary}`,
      `Content-Type: application/octet-stream; name="${name}"`,
      `Content-Disposition: attachment; filename="${name}"`,
      '',
      ...mboxLines(content),
      `--${boundary}--`,
    ],
  };
};

/** One message as an mbox keeps it. An unread message has no `Status:` line, as real mail
 *  stores leave it, so a root can see what its owner has not opened. */
const mboxEntry = (to: string, message: SpoolMessage): string => {
  const delivered = Date.parse(message.delivered_at);
  const mime = mimeOf(message);
  return [
    `From ${message.sender} ${asctime(delivered)}`,
    `Date: ${rfcDate(delivered)}`,
    `From: <${message.sender}>`,
    `To: <${to}>`,
    `Subject: ${message.subject}`,
    ...mime.headers,
    ...(message.read ? ['Status: RO'] : []),
    '',
    ...mime.content,
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
