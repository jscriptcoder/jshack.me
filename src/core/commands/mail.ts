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
 * until the file is mended. `passwd` changes it and mends the file it ran from, so every
 * other copy of the old password, wherever it was saved, fails from then on.
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
  type MessageResult,
  type SendResult,
  type TerminalLine,
} from './types.js';
import { vantageOf } from '../network/vantage.js';
import { hasTty } from '../sessions/hasTty.js';
import { mayExecute, resolveBinary } from './availability.js';
import { homeDirectory } from '../sessions/homeDirectory.js';
import { EMAILIT_DOMAIN } from '../generation/fixedSites.js';
import { MIN_PASSWORD_LENGTH, validatePassword } from '../gameConfig/gameConfig.js';
import { asAbsPath, type AbsPath } from '../types.js';

const SYNOPSIS =
  'mail [read <n>] | send <to> <subject> | reply <n> | delete <n> | passwd | login | logout';
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

/** Save a login to `~/.mailrc`, readable and writable by the user who saved it and by
 *  root, as a mail client leaves its rc file: whoever else can read it holds the mail. */
const saveLogin = (
  env: CommandEnv,
  path: AbsPath,
  login: { readonly address: string; readonly password: string; readonly isNew: boolean },
) => {
  const reach = [...new Set(['root', env.session.userType] as const)];
  return env.patches.write(path, formatMailrc(login.address, login.password), {
    isNew: login.isNew,
    permissions: { read: reach, write: reach, execute: [] },
  });
};

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

/** The login saved in the current user's `~/.mailrc`, and the file as it was read, or
 *  what stops it being used. */
const savedLogin = (
  env: CommandEnv,
):
  | { readonly address: string; readonly login: MailLogin; readonly content: string }
  | { readonly refused: string } => {
  const path = mailrcPath(env);
  const stored = env.fs.read(path);
  if (!stored.ok && stored.error === 'not_found') {
    return { refused: 'mail: not logged in — run mail login' };
  }
  if (!stored.ok && stored.error === 'permission_denied') {
    return { refused: `mail: can't read '${path}': Permission denied` };
  }
  const saved = stored.ok ? loginIn(stored.content) : null;
  if (!stored.ok || saved === null) return { refused: 'mail: ~/.mailrc has no login' };

  const address = saved.address.toLowerCase();
  const handle = handleOf(address);
  if (handle === null) return { refused: `mail: ${address}: unknown domain` };
  return { address, login: { handle, password: saved.password }, content: stored.content };
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

/** The highest number in an inbox, or 0 for an empty one. Numbers only grow, so it is
 *  the newest message there. */
const highestIn = (messages: readonly InboxMessage[]): number =>
  Math.max(0, ...messages.map((message) => message.number));

const list = async (env: CommandEnv, saved: Saved): Promise<CommandResult> => {
  const inbox = await env.mail.inbox(saved.login);
  if (!inbox.ok) return unanswered(saved, inbox.error);
  env.mailSeen(saved.address, highestIn(inbox.messages));
  return said(
    inbox.messages.length === 0 ? [`No mail for ${saved.address}`] : inbox.messages.map(listLine),
  );
};

/** What a request about one message emailit.io refused, or that never got there, says:
 *  a number the inbox does not hold is no message, and the rest as for the inbox. */
const unnumbered = (
  saved: Saved,
  number: number,
  error: Exclude<MessageResult, { ok: true }>['error'],
) => (error === 'no_message' ? refusal(`mail: no message ${number}`) : unanswered(saved, error));

/** Delete a message, for everyone who holds the password. Nothing is marked read, and its
 *  number is never given to another message. */
const remove = async (env: CommandEnv, saved: Saved, number: number): Promise<CommandResult> => {
  const deleted = await env.mail.delete(saved.login, number);
  if (!deleted.ok) return unnumbered(saved, number, deleted.error);
  return said([]);
};

const read = async (env: CommandEnv, saved: Saved, number: number): Promise<CommandResult> => {
  const opened = await env.mail.read(saved.login, number, { mark: true });
  if (!opened.ok) return unnumbered(saved, number, opened.error);
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

  const written = await saveLogin(env, path, {
    address,
    password,
    isNew: fs.stat(path) === null,
  });
  if (!written.ok) {
    return refusal(`mail: can't create '${path}': ${PATCH_ERROR_REASON[written.error]}`);
  }
  env.mailSeen(address, highestIn(inbox.messages));
  return said([newMail(inbox.messages)]);
};

/**
 * Change the password of the login `~/.mailrc` holds, and save the new one there.
 *
 * The old password is the one typed, not the one in the file, so a terminal left open on
 * a saved login is not enough to take the account. Everything that would stop the change
 * from being saved, or from being asked at all, is found before the first prompt, so a
 * password is never changed out from under the file that holds it; a new password typed
 * twice differently, or too short, is refused before emailit.io is asked.
 */
const passwd = async (env: CommandEnv): Promise<CommandResult> => {
  const saved = savedLogin(env);
  if ('refused' in saved) return refusal(saved.refused);
  const path = mailrcPath(env);
  const fs = await env.fs.reload();
  if (!fs.canWrite(path).allowed) return refusal(`mail: can't write '${path}': Permission denied`);
  if (vantageOf(env.session, env.network) === null) return refusal(UNREACHABLE);

  const old = await env.prompt({ message: 'Old password: ', masked: true });
  const password = await env.prompt({ message: 'New password: ', masked: true });
  const retyped = await env.prompt({ message: 'Retype new password: ', masked: true });
  if (retyped !== password) return refusal('mail: passwords do not match');
  if (validatePassword(password) !== null) {
    return refusal(`mail: password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  const changed = await env.mail.passwd({ handle: saved.login.handle, password: old }, password);
  if (!changed.ok) return unanswered(saved, changed.error);
  const written = await saveLogin(env, path, { address: saved.address, password, isNew: false });
  if (!written.ok) {
    return refusal(
      `mail: password changed, but can't write '${path}': ${PATCH_ERROR_REASON[written.error]}`,
    );
  }
  return said([]);
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
 *
 * A script opens no editor. What it `wrote` stands where the player would have typed: on
 * the draft's empty first line, so a scripted reply's text sits above the quote exactly
 * as nano would have left it.
 */
const composeAndSend = async (
  env: CommandEnv,
  saved: Saved,
  message: { readonly to: string; readonly handle: string; readonly subject: string },
  draft: {
    readonly content: string;
    readonly cancelled: string;
    readonly wrote?: string | undefined;
  },
): Promise<CommandResult> => {
  const { to, handle, subject } = message;
  const body =
    draft.wrote === undefined
      ? await env.compose({ to, subject, content: draft.content })
      : `${draft.wrote}${draft.content}`;
  if (body === null || body.trim() === '') return refusal(draft.cancelled);
  if (charactersIn(body) > BODY_LIMIT) return refusal('mail: message too long');

  const sent = await env.mail.send(saved.login, { to: handle, subject, body });
  return sent.ok ? said([]) : unsent(saved, to, sent.error);
};

/**
 * Write a message in nano, or take a script's, and send it from the saved login. A bad
 * address, a subject too long, a login that cannot be used and no network to send from
 * are all found before the editor opens, so none of them costs the player a draft.
 */
const send = async (
  env: CommandEnv,
  typedTo: string,
  subject: string,
  wrote?: string,
): Promise<CommandResult> => {
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
    { content: '', cancelled: 'mail: send cancelled', wrote },
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
const reply = async (
  env: CommandEnv,
  typedNumber: string,
  wrote?: string,
): Promise<CommandResult> => {
  const saved = savedLogin(env);
  if ('refused' in saved) return refusal(saved.refused);
  if (!MESSAGE_NUMBER.test(typedNumber)) return refusal(`mail: no message ${typedNumber}`);
  if (vantageOf(env.session, env.network) === null) return refusal(UNREACHABLE);

  const number = Number(typedNumber);
  const original = await env.mail.read(saved.login, number, { mark: false });
  if (!original.ok) return unnumbered(saved, number, original.error);
  const to = original.message.sender;
  const handle = handleOf(to);
  if (handle === null) return refusal(`mail: ${to}: unknown domain`);

  return composeAndSend(
    env,
    saved,
    { to, handle, subject: replySubject(original.message.subject) },
    {
      content: `\n${quoted(original.message.body)}`,
      cancelled: 'mail: reply cancelled',
      wrote,
    },
  );
};

/**
 * `send` and `reply`, typed or scripted. Typed, the body is written in nano, so the shell
 * needs a terminal for it to draw on, and a subject is every word after the address,
 * needing no quotes. A script writes the body as its last argument instead and opens no
 * editor, so it needs no terminal; each of its arguments is one value, the subject
 * included.
 *
 * The terminal is asked about here rather than in `withoutTty`, which sees only the
 * arguments: `mail send trin hello there` typed and a script's `mail('send', 'trin',
 * 'hello', 'there')` are the same four words, and only one of them needs nano.
 */
const write = (
  env: CommandEnv,
  subcommand: 'send' | 'reply',
  rest: readonly string[],
): Promise<CommandResult> | CommandResult => {
  if (env.scripted === true) {
    const [first, second, third] = rest;
    // An empty address is no address; an empty body is a message cancelled, as typed.
    if (
      subcommand === 'send' &&
      rest.length === 3 &&
      first &&
      second !== undefined &&
      third !== undefined
    ) {
      return send(env, first, second, third);
    }
    if (subcommand === 'reply' && rest.length === 2 && first && second !== undefined) {
      return reply(env, first, second);
    }
    return refusal(USAGE);
  }
  const [target, ...words] = rest;
  if (!hasTty(env.session)) return refusal(`mail: ${subcommand} needs a terminal`);
  if (subcommand === 'send' && target !== undefined && words.length > 0) {
    return send(env, target, words.join(' '));
  }
  if (subcommand === 'reply' && target !== undefined && words.length === 0) {
    return reply(env, target);
  }
  return refusal(USAGE);
};

/**
 * What a terminal remembers between checks for new mail: for each address, the highest
 * message number it has announced or shown (`marks`), and every `~/.mailrc`, by its
 * contents, whose login failed (`stale`). It lives in the terminal's memory and nowhere
 * else.
 */
export type MailWatch = {
  readonly marks: ReadonlyMap<string, number>;
  readonly stale: ReadonlySet<string>;
};

/** A watch with `address` marked as shown up to `highest`. A mark never goes down: a
 *  number is never given to another message, so whatever is above it is new. */
export const markSeen = (watch: MailWatch, address: string, highest: number): MailWatch => ({
  ...watch,
  marks: new Map([...watch.marks, [address, Math.max(watch.marks.get(address) ?? 0, highest)]]),
});

/**
 * Check for new mail: `mail` run quietly where the shell stands, as whoever it stands as.
 *
 * It asks only where a typed `mail` would answer: the `mail` binary there for the current
 * user to run, their `~/.mailrc` readable and holding a login at emailit.io, and a network
 * to ask from. Anything that stops it, a throttled or unanswered request included, is
 * skipped without a word and remembers nothing, since the player did not ask.
 *
 * The notice is about arrival, not reading. Numbers only grow, so a message numbered
 * above the address's mark arrived since the terminal last looked. An address it has not
 * looked at yet, after a reload or on somebody else's box, has no mark: then any unread
 * message is news, and the mark starts at the highest number.
 *
 * A login that fails is said once and its file skipped until the file changes (a new
 * `mail login`, a `mail passwd`, an edit), so a stale file does not spend one of the
 * player's failed guesses every minute.
 */
export const checkMail = async (
  env: CommandEnv,
  watch: MailWatch,
): Promise<{ readonly lines: readonly TerminalLine[]; readonly watch: MailWatch }> => {
  const quiet = { lines: [], watch };
  const binary = resolveBinary(env, 'mail');
  if (binary === null || !mayExecute(binary, env.session.userType)) return quiet;
  const saved = savedLogin(env);
  if ('refused' in saved || watch.stale.has(saved.content)) return quiet;
  if (vantageOf(env.session, env.network) === null) return quiet;

  const inbox = await env.mail.inbox(saved.login);
  if (!inbox.ok && inbox.error === 'login_failed') {
    return {
      lines: [{ kind: 'error', content: `mail: login failed for ${saved.address}` }],
      watch: { ...watch, stale: new Set([...watch.stale, saved.content]) },
    };
  }
  if (!inbox.ok) return quiet;

  const mark = watch.marks.get(saved.address);
  const highest = highestIn(inbox.messages);
  const arrived =
    mark === undefined ? inbox.messages.some((message) => !message.read) : highest > mark;
  return {
    lines: arrived ? [{ kind: 'text', content: 'You have new mail.' }] : [],
    watch: markSeen(watch, saved.address, highest),
  };
};

/** A message number as typed: a whole number from 1, written the way the list writes it. */
const MESSAGE_NUMBER = /^[1-9][0-9]*$/;

const execute: Command['execute'] = async (env, args) => {
  const [subcommand, ...rest] = args;
  if (args.length === 1 && subcommand === 'login') return login(env);
  if (args.length === 1 && subcommand === 'logout') return logout(env);
  if (args.length === 1 && subcommand === 'passwd') return passwd(env);
  if (subcommand === 'send' || subcommand === 'reply') return write(env, subcommand, rest);
  const numbered = (subcommand === 'read' || subcommand === 'delete') && rest.length === 1;
  if (args.length > 0 && !numbered) return refusal(USAGE);

  // What is wrong with the question comes before what is wrong with the network: joining
  // one would mend neither the file nor the number.
  const saved = savedLogin(env);
  if ('refused' in saved) return refusal(saved.refused);
  const typed = rest[0];
  if (typed !== undefined && !MESSAGE_NUMBER.test(typed)) {
    return refusal(`mail: no message ${typed}`);
  }
  if (vantageOf(env.session, env.network) === null) return refusal(UNREACHABLE);

  if (typed === undefined) return list(env, saved);
  return subcommand === 'delete'
    ? remove(env, saved, Number(typed))
    : read(env, saved, Number(typed));
};

export const mail: Command = {
  name: 'mail',
  description: 'Read and send emailit.io mail',
  category: 'network',
  tier: 'guest',
  availability: { kind: 'installed-package', packageName: 'mailutils' },
  // The password prompts need somebody to ask. Reading and logging out ask nothing; send
  // and reply need nano only when typed, which `write` asks about itself.
  withoutTty: (args) =>
    args[0] === 'login' || args[0] === 'passwd' ? `mail: ${args[0]} needs a terminal` : undefined,
  // A script reads mail with a login already saved, and never makes, changes or ends one:
  // a script that could log in could guess passwords as fast as it could loop.
  withoutScript: (args) =>
    args[0] === 'login' || args[0] === 'passwd' || args[0] === 'logout'
      ? `mail: ${args[0]} is interactive`
      : undefined,
  manual: {
    synopsis: SYNOPSIS,
    description:
      'Read and send the mail at an emailit.io address. Sign up for one at emailit.io first. ' +
      'login asks for an address and a password and saves them, in plain text, to ~/.mailrc ' +
      'in the home of the user running it, readable by that user and root: two lines, ' +
      '"set from=" and the address, and "set password=" and the password. The file is the ' +
      'login. mail uses the ~/.mailrc of the user you are, on the box you are on, so ' +
      'another box or another user has its own, and whoever can read that file can read the ' +
      'mail. With no command, mail lists the inbox oldest first, one message to a line: N ' +
      'while it is unread, its number, the sender, when it was delivered (UTC) and the ' +
      'subject. A message keeps its number until it is deleted. read prints one message, ' +
      'its headers and then its body, and marks it read for everyone who holds the ' +
      'password. send writes a message in nano to an address at emailit.io (a handle alone ' +
      'will do), under the subject that follows it: Ctrl-O writes the draft out, and Ctrl-X ' +
      'sends it as it was last written out. Nothing written out, or nothing but blank space, ' +
      'sends nothing. reply answers a message the same way, to its sender under Re: and its ' +
      'subject, with the message quoted below the line you write on; replying does not mark ' +
      'it read. A message sent to a mailbox nobody holds, or to one that is full, bounces ' +
      'when it is sent, and the draft is lost: there is no Sent folder. A subject may be 80 ' +
      'characters, a body 4,000, and you may send 20 messages an hour, bounces included. ' +
      'delete removes a message for everyone who holds the password; its number is never ' +
      'used again. logout deletes ~/.mailrc. The password is checked every time, so once it ' +
      'is changed a saved login fails until it is saved again. passwd asks for the old ' +
      'password and the new one twice, changes it at emailit.io and saves the new one to ' +
      '~/.mailrc, so every other copy of the old password stops working at once, wherever ' +
      'it was saved. Too many wrong passwords in a minute and every login is refused until ' +
      'the minute is up. While the terminal is on screen it checks for new mail every ' +
      'minute, as the user you are on the box you are on, and only where mail itself would ' +
      'work; when a message has arrived it says "You have new mail." at the prompt. If the ' +
      'saved login no longer works, it says once that the login failed, and stops asking ' +
      'with it until ~/.mailrc changes. emailit.io is reached over the network the box is ' +
      'on, as curl would reach it. From a script the list, read and delete work as typed, ' +
      'and send and reply take the body as their last argument: ' +
      "mail('send', 'trin', 'hi', 'body'). login, passwd and logout do not work from a script.",
    arguments: [
      {
        name: 'command',
        description:
          '"read", to print one message, "send", to write one, "reply", to answer one, ' +
          '"delete", to remove one, "passwd", to change the password, "login", to save an ' +
          'address and its password, or "logout", to delete the saved login (default: list ' +
          'the inbox)',
        required: false,
        values: ['read', 'send', 'reply', 'delete', 'passwd', 'login', 'logout'],
      },
      {
        name: 'n',
        description: 'For "read", "reply" and "delete": the number of the message',
        required: false,
      },
      {
        name: 'to',
        description: 'For "send": the address, or the handle alone',
        required: false,
      },
      {
        name: 'subject',
        description: 'For "send": the subject, every word after the address',
        required: false,
      },
    ],
    examples: [
      {
        command: 'mail login',
        description: 'Save an address and its password to ~/.mailrc',
      },
      { command: 'mail', description: 'List the inbox' },
      { command: 'mail read 1', description: 'Print message 1, and mark it read' },
      {
        command: 'mail send trin hello there',
        description: 'Write a message to trin@emailit.io in nano, and send it',
      },
      { command: 'mail reply 1', description: 'Answer message 1, with it quoted below' },
      { command: 'mail delete 1', description: 'Delete message 1' },
      {
        command: 'mail passwd',
        description: 'Change the password, and save the new one to ~/.mailrc',
      },
      { command: 'mail logout', description: 'Delete the saved login' },
      {
        command: 'cat ~/.mailrc',
        description: 'See the login mail is using, password and all',
      },
    ],
  },
  execute,
};
