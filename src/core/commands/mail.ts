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

import {
  PATCH_ERROR_REASON,
  type Command,
  type CommandEnv,
  type CommandResult,
  type InboxMessage,
  type InboxResult,
  type MailLogin,
  type MailMessage,
} from './types.js';
import { vantageOf } from '../network/vantage.js';
import { homeDirectory } from '../sessions/homeDirectory.js';
import { EMAILIT_DOMAIN } from '../generation/fixedSites.js';
import { asAbsPath, type AbsPath } from '../types.js';

const SYNOPSIS = 'mail [read <n>] | login | logout';
const USAGE = `mail: usage: ${SYNOPSIS}`;

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

/** The file that is the login: the current user's `~/.mailrc` on the current box. */
const mailrcPath = (env: CommandEnv): AbsPath => asAbsPath(`${homeDirectory(env.session)}/.mailrc`);

/** A login as `~/.mailrc` keeps it. */
const formatMailrc = (address: string, password: string): string =>
  `set from=${address}\nset password=${password}\n`;

/** The handle of an address at emailit.io, or null for an address anywhere else. Callers
 *  fold the address to lowercase first: one address whatever case it was written in, as
 *  a sign-up folds a handle. */
const handleOf = (address: string): string | null => {
  const at = address.lastIndexOf('@');
  return at === -1 || address.slice(at + 1) !== EMAILIT_DOMAIN ? null : address.slice(0, at);
};

/** The login saved in the current user's `~/.mailrc`, or what stops it being used. */
const savedLogin = (
  env: CommandEnv,
): { readonly address: string; readonly login: MailLogin } | { readonly refused: string } => {
  const path = mailrcPath(env);
  const stored = env.fs.read(path);
  if (!stored.ok && stored.error === 'not_found') {
    return { refused: 'mail: not logged in — run mail login' };
  }
  if (!stored.ok && stored.error === 'permission_denied') {
    return { refused: `mail: can't read '${path}': Permission denied` };
  }
  const saved = stored.ok ? loginIn(stored.content) : null;
  if (saved === null) return { refused: 'mail: ~/.mailrc has no login' };

  const address = saved.address.toLowerCase();
  const handle = handleOf(address);
  if (handle === null) return { refused: `mail: ${address}: unknown domain` };
  return { address, login: { handle, password: saved.password } };
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

type Saved = { readonly address: string; readonly login: MailLogin };

/** What a request emailit.io refused, or that never got there, says. */
const unanswered = (saved: Saved, error: Exclude<InboxResult, { ok: true }>['error']) => {
  if (error === 'login_failed') return refusal(`mail: login failed for ${saved.address}`);
  // Held back for guessing wrong too often: nothing was checked, the right password
  // included, until the player's oldest failure is a minute old.
  if (error === 'throttled') return refusal('mail: too many failed logins, wait a minute');
  return refusal(UNREACHABLE);
};

/** A message's `Date:` header: `Thu, 15 Oct 2026 09:12:03 +0000`, in UTC. */
const headerDate = (deliveredAt: string): string =>
  new Date(deliveredAt).toUTCString().replace(/GMT$/, '+0000');

/** A message as `read` prints it: its headers, a blank line, then the body as written. */
const messageLines = (address: string, message: MailMessage): readonly string[] => [
  `From: ${message.sender}`,
  `To: ${address}`,
  `Date: ${headerDate(message.deliveredAt)}`,
  `Subject: ${message.subject}`,
  '',
  // A body ends with its last line's newline, which is no line of its own.
  ...(message.body.endsWith('\n') ? message.body.slice(0, -1) : message.body).split('\n'),
];

const said = (lines: readonly string[]): CommandResult => ({
  kind: 'sync',
  lines: lines.map((content) => ({ kind: 'text', content })),
  exitCode: 0,
});

const list = async (env: CommandEnv, saved: Saved): Promise<CommandResult> => {
  const inbox = await env.mail.inbox(saved.login);
  if (!inbox.ok) return unanswered(saved, inbox.error);
  return said(
    inbox.messages.length === 0 ? [`No mail for ${saved.address}`] : inbox.messages.map(listLine),
  );
};

const read = async (env: CommandEnv, saved: Saved, number: number): Promise<CommandResult> => {
  const opened = await env.mail.read(saved.login, number);
  if (!opened.ok) {
    return opened.error === 'no_message'
      ? refusal(`mail: no message ${number}`)
      : unanswered(saved, opened.error);
  }
  return said(messageLines(saved.address, opened.message));
};

/** How many messages of an inbox nobody has read yet, as login announces them. */
const newMail = (messages: readonly InboxMessage[]): string => {
  const unread = messages.filter((message) => !message.read).length;
  if (unread === 0) return 'You have no new messages.';
  return unread === 1 ? 'You have 1 new message.' : `You have ${unread} new messages.`;
};

/**
 * Log in by writing the login to `~/.mailrc`, the only place a login lives.
 *
 * emailit.io is asked first, so a login that fails writes nothing and leaves a file
 * already there as it was. A home that cannot take the file is found out before anybody
 * is asked, so a doomed login spends no password check.
 */
const login = async (env: CommandEnv): Promise<CommandResult> => {
  const typed = (await env.prompt({ message: 'Address: ', masked: false })).trim().toLowerCase();
  if (typed === '') return refusal('mail: no address given');
  const address = typed.includes('@') ? typed : `${typed}@${EMAILIT_DOMAIN}`;
  const handle = handleOf(address);
  if (handle === null) return refusal(`mail: ${address}: unknown domain`);
  const password = await env.prompt({ message: 'Password: ', masked: true });

  // Asked of the machine rather than of what this terminal last pulled: a file written a
  // moment ago in another terminal is one this replaces, not one it creates.
  const fs = await env.fs.reload();
  const path = mailrcPath(env);
  if (!fs.canWrite(path).allowed) return refusal(`mail: can't create '${path}': Permission denied`);
  if (vantageOf(env.session, env.network) === null) return refusal(UNREACHABLE);

  const saved = { address, login: { handle, password } };
  const inbox = await env.mail.inbox(saved.login);
  if (!inbox.ok) return unanswered(saved, inbox.error);

  // Readable and writable by the user who saved it and by root, as a mail client leaves
  // its rc file: whoever else can read it holds the mail.
  const reach = [...new Set(['root', env.session.userType] as const)];
  const written = await env.patches.write(path, formatMailrc(address, password), {
    isNew: fs.stat(path) === null,
    permissions: { read: reach, write: reach, execute: [] },
  });
  if (!written.ok) {
    return refusal(`mail: can't create '${path}': ${PATCH_ERROR_REASON[written.error]}`);
  }
  return said([newMail(inbox.messages)]);
};

/** Log out by deleting `~/.mailrc`. emailit.io is not asked: it keeps no session to end. */
const logout = async (env: CommandEnv): Promise<CommandResult> => {
  const path = mailrcPath(env);
  const fs = await env.fs.reload();
  if (fs.stat(path) === null) return refusal('mail: not logged in');
  const removed = await env.patches.remove(path);
  if (!removed.ok) {
    return refusal(`mail: can't remove '${path}': ${PATCH_ERROR_REASON[removed.error]}`);
  }
  return said([]);
};

/** A message number as typed: a whole number from 1, written the way the list writes it. */
const MESSAGE_NUMBER = /^[1-9][0-9]*$/;

const execute: Command['execute'] = async (env, args) => {
  const [subcommand, ...rest] = args;
  if (args.length === 1 && subcommand === 'login') return login(env);
  if (args.length === 1 && subcommand === 'logout') return logout(env);
  const reading = subcommand === 'read' && rest.length === 1;
  if (args.length > 0 && !reading) return refusal(USAGE);

  // What is wrong with the question comes before what is wrong with the network: joining
  // one would mend neither the file nor the number.
  const saved = savedLogin(env);
  if ('refused' in saved) return refusal(saved.refused);
  const typed = rest[0];
  if (typed !== undefined && !MESSAGE_NUMBER.test(typed)) {
    return refusal(`mail: no message ${typed}`);
  }
  if (vantageOf(env.session, env.network) === null) return refusal(UNREACHABLE);

  return typed === undefined ? list(env, saved) : read(env, saved, Number(typed));
};

export const mail: Command = {
  name: 'mail',
  description: 'Read your emailit.io mail',
  category: 'network',
  tier: 'guest',
  availability: { kind: 'installed-package', packageName: 'mailutils' },
  // The password prompt needs somebody to ask. Reading and logging out ask nothing.
  withoutTty: (args) => (args[0] === 'login' ? 'mail: login needs a terminal' : undefined),
  // A script reads mail with a login already saved, and never makes or ends one: a
  // script that could log in could guess passwords as fast as it could loop.
  withoutScript: (args) =>
    args[0] === 'login' || args[0] === 'logout' ? `mail: ${args[0]} is interactive` : undefined,
  manual: {
    synopsis: SYNOPSIS,
    description:
      'Read the mail at an emailit.io address. Sign up for one at emailit.io first. ' +
      'login asks for an address and a password and saves them, in plain text, to ~/.mailrc ' +
      'in the home of the user running it, readable by that user and root: two lines, ' +
      '"set from=" and the address, and "set password=" and the password. The file is the ' +
      'login. mail uses the ~/.mailrc of the user you are, on the box you are on, so ' +
      'another box or another user has its own, and whoever can read that file can read the ' +
      'mail. With no command, mail lists the inbox oldest first, one message to a line: N ' +
      'while it is unread, its number, the sender, when it was delivered (UTC) and the ' +
      'subject. A message keeps its number until it is deleted. read prints one message, ' +
      'its headers and then its body, and marks it read for everyone who holds the ' +
      'password. logout deletes ~/.mailrc. The password is checked every time, so once it ' +
      'is changed a saved login fails until it is saved again. Too many wrong passwords in ' +
      'a minute and every login is refused until the minute is up. emailit.io is reached ' +
      'over the network the box is on, as curl would reach it. read and the list work from ' +
      'a script; login and logout do not.',
    arguments: [
      {
        name: 'command',
        description:
          '"read", to print one message, "login", to save an address and its password, or ' +
          '"logout", to delete the saved login (default: list the inbox)',
        required: false,
        values: ['read', 'login', 'logout'],
      },
      { name: 'n', description: 'For "read": the number of the message', required: false },
    ],
    examples: [
      {
        command: 'mail login',
        description: 'Save an address and its password to ~/.mailrc',
      },
      { command: 'mail', description: 'List the inbox' },
      { command: 'mail read 1', description: 'Print message 1, and mark it read' },
      { command: 'mail logout', description: 'Delete the saved login' },
      {
        command: 'cat ~/.mailrc',
        description: 'See the login mail is using, password and all',
      },
    ],
  },
  execute,
};
