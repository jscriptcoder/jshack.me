/**
 * Signing up at emailit.io: what a form POSTed to `/signup` becomes.
 *
 * The form is decoded the way a web server decodes `application/x-www-form-urlencoded`,
 * the handle is folded to lowercase so `Neo` and `neo` are one address, and both fields
 * are checked by the rules the Intro form uses for a username and a password. Only then
 * is the store asked, and the store alone can say a handle is taken or the player has
 * signed up too often today: those are decided where two requests at once cannot both
 * slip past them.
 *
 * The store is handed the md5 of the password, never the password: nothing anywhere keeps
 * it, and the hash is the deliberately weak one every password in the world is kept as.
 */

import { z } from 'zod';
import { md5 } from '../generation/md5.js';
import { validatePassword, validateUsername } from '../gameConfig/gameConfig.js';
import { EMAILIT_DOMAIN } from '../generation/fixedSites.js';
import { emailitFrontPage, welcomePage, type Refusal } from './pages.js';

/** Handles nobody may sign up for, on top of the system names the Intro form keeps for
 *  itself (`root` and `admin` among them): they are the addresses mail itself is run from,
 *  and `noreply` is the one the welcome comes from. */
const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  'postmaster',
  'abuse',
  'noreply',
  'support',
  'emailit',
  'talkit',
  'hireme',
]);

/** The system sender every welcome comes from. Nobody can log in as it. */
const WELCOME_SENDER = `noreply@${EMAILIT_DOMAIN}`;

const WELCOME_SUBJECT = `Welcome to ${EMAILIT_DOMAIN}`;

const welcomeBody = (handle: string): string =>
  [
    `Welcome to ${EMAILIT_DOMAIN}, ${handle}.`,
    '',
    `Your address is ${handle}@${EMAILIT_DOMAIN}. Anyone who knows it`,
    'can write to you.',
    '',
    'We cannot reset a lost password, and we will never',
    'ask you for it.',
    '',
    'This mailbox is not read. Replies go nowhere.',
    '',
    `-- ${EMAILIT_DOMAIN}`,
    '',
  ].join('\n');

/** The account the store is asked to open, and the welcome to deliver into it in the same
 *  step: an address that exists has its welcome waiting. */
export type NewAccount = {
  readonly handle: string;
  readonly passwordMd5: string;
  /** The player who signed up, counted against the day's sign-ups. Never part of the
   *  account: an address belongs to whoever holds its password. */
  readonly playerKey: string;
  readonly welcome: { readonly sender: string; readonly subject: string; readonly body: string };
};

/** The store's word for what it did. `taken`: somebody holds the handle. `capped`: the
 *  player has signed up as often as a day allows. */
const signUpOutcomeSchema = z.enum(['created', 'taken', 'capped']);

type SignUpOutcome = z.infer<typeof signUpOutcomeSchema>;

/** Open an account, or say why not: the store's reply as it came off the wire, read
 *  here. */
export type SignUp = (
  account: NewAccount,
) => Promise<{ readonly data: unknown; readonly error: unknown }>;

const REFUSED_BY_STORE: Readonly<Record<Exclude<SignUpOutcome, 'created'>, Refusal>> = {
  taken: { message: 'That handle is taken', under: 'handle' },
  capped: { message: 'You have signed up 3 addresses today. Try again tomorrow.', under: 'submit' },
};

/** Why `handle` cannot be signed up for, or null when it can. */
const refusedHandle = (handle: string): string | null =>
  validateUsername(handle) ??
  (RESERVED_HANDLES.has(handle) ? `"${handle}" is a reserved system name` : null);

/** Why the form cannot be signed up with as it stands, or null when the store can be
 *  asked. */
const refusedForm = (handle: string, password: string): Refusal | null => {
  const handleRefusal = refusedHandle(handle);
  if (handleRefusal !== null) return { message: handleRefusal, under: 'handle' };
  const passwordRefusal = validatePassword(password);
  return passwordRefusal === null ? null : { message: passwordRefusal, under: 'password' };
};

/** The page a sign-up answers with, or null when the store could not be asked. */
export const answerSignup = async ({
  form,
  playerKey,
  signUp,
}: {
  /** The request body exactly as sent. */
  readonly form: string;
  readonly playerKey: string;
  readonly signUp: SignUp;
}): Promise<string | null> => {
  const fields = new URLSearchParams(form);
  // A refusal hands the handle back as it was typed, for the reader to correct.
  const typedHandle = fields.get('handle') ?? '';
  const handle = typedHandle.toLowerCase();
  const password = fields.get('password') ?? '';

  const refusal = refusedForm(handle, password);
  if (refusal !== null) return emailitFrontPage({ refusal, handle: typedHandle });

  const reply = await signUp({
    handle,
    passwordMd5: md5(password),
    playerKey,
    welcome: { sender: WELCOME_SENDER, subject: WELCOME_SUBJECT, body: welcomeBody(handle) },
  });
  // A store that failed, or answered with a word nobody taught it, has not said what
  // happened: a page claiming either way would be a guess.
  const read = signUpOutcomeSchema.safeParse(reply.data);
  if (reply.error || !read.success) return null;
  const outcome = read.data;
  return outcome === 'created'
    ? welcomePage(`${handle}@${EMAILIT_DOMAIN}`)
    : emailitFrontPage({ refusal: REFUSED_BY_STORE[outcome], handle: typedHandle });
};
