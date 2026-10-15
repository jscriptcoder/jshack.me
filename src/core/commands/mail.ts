/**
 * mail — the inbox of whoever `~/.mailrc` names.
 *
 * The file is the login. `mail` reads the address and password saved in the current
 * user's `~/.mailrc` on the box the shell stands on, and asks emailit.io with them;
 * nothing of a login lives anywhere else. So a shell that hops to another box uses that
 * box's file, `su` uses the new user's, and whoever can read somebody's `~/.mailrc`
 * reads their mail.
 *
 * The server keeps no mail session, so every run sends the login again and the server
 * checks it again: a password changed since the file was saved fails here, every time,
 * until the file is mended.
 *
 * emailit.io is out on the internet, so asking it takes a network to ask from, the one
 * the shell's box stands on, exactly as `curl` there would.
 */

import type { Command, CommandEnv, CommandResult, InboxMessage, MailLogin } from './types.js';
import { vantageOf } from '../network/vantage.js';
import { homeDirectory } from '../sessions/homeDirectory.js';
import { EMAILIT_DOMAIN } from '../generation/fixedSites.js';
import { asAbsPath } from '../types.js';

const USAGE = 'mail: usage: mail';

/** No network to ask from, emailit.io not answering, or our own side failing to ask:
 *  to the player they are one thing, the mail is not there to be had. */
const UNREACHABLE = 'mail: cannot reach emailit.io';

/** The widest a line of the list may be. */
const LIST_WIDTH = 80;

/** How wide the sender's column is. A longer address pushes the date along. */
const SENDER_WIDTH = 22;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const refusal = (message: string): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content: message }],
  exitCode: 1,
});

/** The address and password a `~/.mailrc` holds, or null when it is missing either. Each
 *  is a `set` line whose value runs to the end of the line, as in a real one; blank lines
 *  and `#` comments are skipped. */
const loginIn = (
  content: string,
): { readonly address: string; readonly password: string } | null => {
  const settings = new Map<string, string>();
  for (const line of content.split('\n')) {
    const setting = /^\s*set (from|password)=(.*)$/.exec(line);
    if (setting !== null) settings.set(setting[1] as string, setting[2] as string);
  }
  const address = settings.get('from');
  const password = settings.get('password');
  return address === undefined || password === undefined ? null : { address, password };
};

/** The login saved in the current user's `~/.mailrc`, or what stops it being used. */
const savedLogin = (
  env: CommandEnv,
): { readonly address: string; readonly login: MailLogin } | { readonly refused: string } => {
  const path = asAbsPath(`${homeDirectory(env.session)}/.mailrc`);
  const stored = env.fs.read(path);
  if (!stored.ok && stored.error === 'not_found') {
    return { refused: 'mail: not logged in — run mail login' };
  }
  if (!stored.ok && stored.error === 'permission_denied') {
    return { refused: `mail: can't read '${path}': Permission denied` };
  }
  const saved = stored.ok ? loginIn(stored.content) : null;
  if (saved === null) return { refused: 'mail: ~/.mailrc has no login' };

  // One address whatever case it was saved in, as a sign-up folds a handle.
  const address = saved.address.toLowerCase();
  const at = address.lastIndexOf('@');
  if (at === -1 || address.slice(at + 1) !== EMAILIT_DOMAIN) {
    return { refused: `mail: ${address}: unknown domain` };
  }
  return { address, login: { handle: address.slice(0, at), password: saved.password } };
};

/** When a message was delivered, as the list shows it: `Oct 15 09:12`, in UTC like
 *  every log in the world. */
const listDate = (deliveredAt: string): string => {
  const delivered = new Date(deliveredAt);
  const day = String(delivered.getUTCDate()).padStart(2, ' ');
  const hours = String(delivered.getUTCHours()).padStart(2, '0');
  const minutes = String(delivered.getUTCMinutes()).padStart(2, '0');
  return `${MONTHS[delivered.getUTCMonth()]} ${day} ${hours}:${minutes}`;
};

/** One message as a line of the list: `N` while unread, its number, the sender, the
 *  date and the subject, cut to the width of the list. */
const listLine = ({ number, sender, subject, deliveredAt, read }: InboxMessage): string =>
  [
    read ? ' ' : 'N',
    String(number).padStart(3, ' '),
    sender.padEnd(SENDER_WIDTH, ' '),
    listDate(deliveredAt),
    subject,
  ]
    .join('  ')
    .slice(0, LIST_WIDTH);

const list = async (env: CommandEnv): Promise<CommandResult> => {
  const saved = savedLogin(env);
  // What is wrong with the file comes before what is wrong with the network: joining one
  // would not mend it.
  if ('refused' in saved) return refusal(saved.refused);
  if (vantageOf(env.session, env.network) === null) return refusal(UNREACHABLE);

  const inbox = await env.mail.inbox(saved.login);
  if (!inbox.ok && inbox.error === 'login_failed') {
    return refusal(`mail: login failed for ${saved.address}`);
  }
  if (!inbox.ok) return refusal(UNREACHABLE);
  return {
    kind: 'sync',
    lines:
      inbox.messages.length === 0
        ? [{ kind: 'text', content: `No mail for ${saved.address}` }]
        : inbox.messages.map((message) => ({ kind: 'text', content: listLine(message) })),
    exitCode: 0,
  };
};

const execute: Command['execute'] = async (env, args) =>
  args.length === 0 ? list(env) : refusal(USAGE);

export const mail: Command = {
  name: 'mail',
  description: 'Read your emailit.io mail',
  category: 'network',
  tier: 'guest',
  availability: { kind: 'installed-package', packageName: 'mailutils' },
  manual: {
    synopsis: 'mail',
    description:
      'List the mail at the emailit.io address saved in ~/.mailrc, oldest first, one message ' +
      'to a line: N while it is unread, its number, the sender, when it was delivered (UTC) ' +
      'and the subject. The file is the login: mail uses the ~/.mailrc of the user you are ' +
      'on the box you are on, and whoever can read that file can read the mail. It holds ' +
      'two lines, "set from=" and the address, and "set password=" and the password, in ' +
      'plain text. emailit.io is reached over the network the box is on, as curl would ' +
      'reach it.',
    arguments: [],
  },
  execute,
};
