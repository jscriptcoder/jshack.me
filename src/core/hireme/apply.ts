/**
 * Applying at hireme.io: what a form POSTed to `/apply` becomes.
 *
 * The form is decoded the way a web server decodes `application/x-www-form-urlencoded`,
 * and the address is read as `mail` reads a recipient, so `Neo` is `neo@emailit.io`. Only
 * an emailit.io handle can apply: the board's address is mailed to it, and whoever holds
 * the mailbox holds the board.
 *
 * The store decides the rest in one step, where two applications at once cannot both slip
 * past it: whether the handle has a mailbox, whether it was mailed too recently, and which
 * address its board is at. The address is drawn here and offered; a handle that already
 * has a board keeps it, and an address somebody else holds is drawn again.
 */

import { z } from 'zod';
import { validateUsername } from '../gameConfig/gameConfig.js';
import { handleOf, typedAddress } from '../emailit/mailrc.js';
import { EMAILIT_DOMAIN, HIREME_DOMAIN } from '../generation/fixedSites.js';
import { hiremeFrontPage, thanksPage, type Refusal } from './pages.js';

/** The system sender every application mail comes from. Nobody can log in as it, and a
 *  reply to it goes nowhere: `mail` writes only to emailit.io. */
const JOBS_SENDER = `jobs@${HIREME_DOMAIN}`;

const MAIL_SUBJECT = `Your ${HIREME_DOMAIN} application`;

/** Where the store writes the board's address into the mail: the address the handle
 *  holds, which on a re-send is not the one just drawn. A handle holds no braces, so
 *  nothing typed can become it. */
const ADDRESS_PLACEHOLDER = '{address}';

const mailBody = (handle: string): string =>
  [
    `Thanks for applying, ${handle}.`,
    '',
    `Your contractor board is at http://${ADDRESS_PLACEHOLDER}/`,
    '',
    'Open it with lynx or curl:',
    '',
    `  lynx http://${ADDRESS_PLACEHOLDER}/`,
    '',
    `-- ${HIREME_DOMAIN}`,
    '',
  ].join('\n');

/** How many addresses are offered before giving up. Collisions are rare enough that
 *  running out is a fault, not a player's bad luck. */
const MAX_DRAWS = 5;

/** What the store is asked: the handle, an address its board may take, and the mail to
 *  deliver with the board's address written in. */
export type BoardApplication = {
  readonly handle: string;
  readonly candidateAddress: string;
  readonly mail: { readonly sender: string; readonly subject: string; readonly body: string };
};

/** The store's word for what it did. `no_mailbox`: no account holds the handle. `recent`:
 *  the handle was mailed too recently, and nothing was sent. `collision`: the handle has no
 *  board and somebody else holds the address offered. `sent`: the mail is delivered. */
const applyOutcomeSchema = z.enum(['no_mailbox', 'recent', 'collision', 'sent']);

/** Apply, or say why not: the store's reply as it came off the wire, read here. */
export type Apply = (
  application: BoardApplication,
) => Promise<{ readonly data: unknown; readonly error: unknown }>;

const NO_SUCH_MAILBOX: Refusal = { message: 'No such mailbox', under: 'email' };

const ALREADY_APPLIED: Refusal = {
  message: 'We already have your application. Check your inbox.',
  under: 'submit',
};

/** The handle an address typed as `typed` applies for, or why it cannot apply. */
const applicant = (typed: string): { readonly handle: string } | Refusal => {
  if (typed.trim() === '') return { message: 'Enter your emailit.io address', under: 'email' };
  const handle = handleOf(typedAddress(typed));
  if (handle === null) return { message: 'Only emailit.io addresses can apply', under: 'email' };
  return validateUsername(handle) === null ? { handle } : NO_SUCH_MAILBOX;
};

/** The page an application answers with, or null when the store could not say what
 *  happened. */
export const answerApply = async ({
  form,
  apply,
  drawBoardAddress,
}: {
  /** The request body exactly as sent. */
  readonly form: string;
  readonly apply: Apply;
  /** A fresh address in the boards' block, offered to the store. */
  readonly drawBoardAddress: () => string;
}): Promise<string | null> => {
  // A refusal hands the address back as it was typed, for the reader to correct.
  const typed = new URLSearchParams(form).get('email') ?? '';
  const refusedWith = (refusal: Refusal) => hiremeFrontPage({ refusal, email: typed });

  const read = applicant(typed);
  if (!('handle' in read)) return refusedWith(read);
  const { handle } = read;

  const mail = { sender: JOBS_SENDER, subject: MAIL_SUBJECT, body: mailBody(handle) };
  for (let draw = 0; draw < MAX_DRAWS; draw += 1) {
    const reply = await apply({ handle, candidateAddress: drawBoardAddress(), mail });
    // A store that failed, or answered with a word nobody taught it, has not said what
    // happened: a page claiming either way would be a guess.
    const outcome = applyOutcomeSchema.safeParse(reply.data);
    if (reply.error || !outcome.success) return null;
    if (outcome.data === 'sent') return thanksPage(handle, `${handle}@${EMAILIT_DOMAIN}`);
    if (outcome.data === 'recent') return refusedWith(ALREADY_APPLIED);
    if (outcome.data === 'no_mailbox') return refusedWith(NO_SUCH_MAILBOX);
  }
  return null;
};
