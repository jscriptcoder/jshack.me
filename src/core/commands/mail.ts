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
  type SendResult,
} from './types.js';
import { vantageOf } from '../network/vantage.js';
import { homeDirectory } from '../sessions/homeDirectory.js';
import { EMAILIT_DOMAIN } from '../generation/fixedSites.js';
import { asAbsPath, type AbsPath } from '../types.js';

const SYNOPSIS = 'mail [read <n>] | send <to> <subject> | reply <n> | login | logout';
const USAGE = `mail: usage: ${SYNOPSIS}`;

/** No network to ask from, emailit.io not answering, or our own side failing to ask:
 *  to the player they are one thing, the mail is not there to be had. */
const UNREACHABLE = 'mail: cannot reach emailit.io';

/** The widest a line of the list may be. */
const LIST_WIDTH = 80;

/** How wide the sender's column is. A longer address pushes the date along. */
const SENDER_WIDTH = 22;

/** The longest subject and body a message may have, counted as a reader counts them. */
const SUBJECT_LIMIT = 80;
const BODY_LIMIT = 4000;

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

/** An address as the player typed it, in full: lowercased, and a bare handle taken to
 *  be at emailit.io. */
const typedAddress = (typed: string): string => {
  const lowered = typed.trim().toLowerCase();
  return lowered.includes('@') ? lowered : `${lowered}@${EMAILIT_DOMAIN}`;
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

/** The lines of a body as written. A body ends with its last line's newline, which is no
 *  line of its own. */
const bodyLines = (body: string): readonly string[] =>
  (body.endsWith('\n') ? body.slice(0, -1) : body).split('\n');

/** A message as `read` prints it: its headers, a blank line, then the body as written. */
const messageLines = (address: string, message: MailMessage): readonly string[] => [
  `From: ${message.sender}`,
  `To: ${address}`,
  `Date: ${headerDate(message.deliveredAt)}`,
  `Subject: ${message.subject}`,
  '',
  ...bodyLines(message.body),
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
  const opened = await env.mail.read(saved.login, number, { mark: true });
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
  const typed = await env.prompt({ message: 'Address: ', masked: false });
  if (typed.trim() === '') return refusal('mail: no address given');
  const address = typedAddress(typed);
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

/** How long a text is as a reader counts it: an emoji is one character, where
 *  JavaScript's `length` would count two. emailit.io counts the same way. */
const charactersIn = (text: string): number => [...text].length;

/** What a send emailit.io refused, or that never got there, says. A bounce names the
 *  address it bounced from. */
const unsent = (saved: Saved, to: string, error: Exclude<SendResult, { ok: true }>['error']) => {
  if (error === 'no_mailbox') return refusal(`mail: ${to}: no such mailbox`);
  if (error === 'mailbox_full') return refusal(`mail: ${to}: mailbox full`);
  // 20 sends in the last hour, bounces included; the draft is gone with this one.
  if (error === 'send_limited') return refusal('mail: too many messages sent, wait an hour');
  return unanswered(saved, error);
};

/**
 * Open the editor on a message and send what was written out.
 *
 * Whatever could be found out before the editor opened already was, so nothing that
 * cost the player a draft is left but what only emailit.io knows: a mailbox nobody holds
 * or one that is full is found when the message goes, and the draft goes with it, since
 * there is no Sent folder.
 */
const composeAndSend = async (
  env: CommandEnv,
  saved: Saved,
  message: { readonly to: string; readonly handle: string; readonly subject: string },
  draft: { readonly content: string; readonly cancelled: string },
): Promise<CommandResult> => {
  const { to, handle, subject } = message;
  const body = await env.compose({ to, subject, content: draft.content });
  if (body === null || body.trim() === '') return refusal(draft.cancelled);
  if (charactersIn(body) > BODY_LIMIT) return refusal('mail: message too long');

  const sent = await env.mail.send(saved.login, { to: handle, subject, body });
  return sent.ok ? said([]) : unsent(saved, to, sent.error);
};

/**
 * Write a message in nano and send it from the saved login. A bad address, a subject too
 * long, a login that cannot be used and no network to send from are all found before the
 * editor opens, so none of them costs the player a draft.
 */
const send = async (env: CommandEnv, typedTo: string, subject: string): Promise<CommandResult> => {
  const to = typedAddress(typedTo);
  const handle = handleOf(to);
  if (handle === null) return refusal(`mail: ${to}: unknown domain`);
  if (charactersIn(subject) > SUBJECT_LIMIT) return refusal('mail: subject too long');
  const saved = savedLogin(env);
  if ('refused' in saved) return refusal(saved.refused);
  if (vantageOf(env.session, env.network) === null) return refusal(UNREACHABLE);

  return composeAndSend(
    env,
    saved,
    { to, handle, subject },
    { content: '', cancelled: 'mail: send cancelled' },
  );
};

/** A reply's subject: `Re:` in front of the original's, unless it already wears one, cut
 *  to the longest a subject may be. */
const replySubject = (subject: string): string =>
  [...(subject.startsWith('Re: ') ? subject : `Re: ${subject}`)].slice(0, SUBJECT_LIMIT).join('');

/** A message quoted for a reply: every line of it behind `> `, so its own quotes go one
 *  deeper and the whole history comes along. */
const quoted = (body: string): string =>
  `${bodyLines(body)
    .map((line) => `> ${line}`)
    .join('\n')}\n`;

/**
 * Answer a message: write in nano, on an empty line above the original quoted, and send
 * it to whoever sent the original. The original is read without being marked read, so a
 * reply leaves the inbox's marks as it found them. A reply to a system sender bounces,
 * since nobody holds its handle.
 */
const reply = async (env: CommandEnv, typedNumber: string): Promise<CommandResult> => {
  const saved = savedLogin(env);
  if ('refused' in saved) return refusal(saved.refused);
  if (!MESSAGE_NUMBER.test(typedNumber)) return refusal(`mail: no message ${typedNumber}`);
  if (vantageOf(env.session, env.network) === null) return refusal(UNREACHABLE);

  const original = await env.mail.read(saved.login, Number(typedNumber), { mark: false });
  if (!original.ok) {
    return original.error === 'no_message'
      ? refusal(`mail: no message ${typedNumber}`)
      : unanswered(saved, original.error);
  }
  const to = original.message.sender;
  const handle = handleOf(to);
  if (handle === null) return refusal(`mail: ${to}: unknown domain`);

  return composeAndSend(
    env,
    saved,
    { to, handle, subject: replySubject(original.message.subject) },
    { content: `\n${quoted(original.message.body)}`, cancelled: 'mail: reply cancelled' },
  );
};

/** A message number as typed: a whole number from 1, written the way the list writes it. */
const MESSAGE_NUMBER = /^[1-9][0-9]*$/;

const execute: Command['execute'] = async (env, args) => {
  const [subcommand, ...rest] = args;
  if (args.length === 1 && subcommand === 'login') return login(env);
  if (args.length === 1 && subcommand === 'logout') return logout(env);
  const [target, ...words] = rest;
  // A subject is every word after the address, so it needs no quotes.
  if (subcommand === 'send' && target !== undefined && words.length > 0) {
    return send(env, target, words.join(' '));
  }
  if (subcommand === 'reply' && target !== undefined && words.length === 0) {
    return reply(env, target);
  }
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
