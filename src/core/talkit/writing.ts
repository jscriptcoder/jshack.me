/**
 * What a player may write at talkit.io, a post or a comment, and what the store says when
 * it refuses either.
 *
 * Line endings are made one kind first, so a CRLF is one character and a lone CR breaks a
 * line as it does on the screen. Then any other control character refuses the writing: the
 * forum is plain text, and a character a terminal would act on has no place in it. A body
 * is trimmed and counted as a reader counts it.
 *
 * The store checks the password as emailit.io does, so a stolen login writes as its owner
 * and a stale one fails, and it holds posts and comments together under one hourly cap.
 */

import { z } from 'zod';
import { EMAILIT_DOMAIN } from '../generation/fixedSites.js';

/** The longest a post's body or a comment may be. */
export const BODY_LIMIT = 4000;

/** The first character a terminal prints rather than acts on, and DEL, the one after the
 *  printable run that it acts on too. */
const FIRST_PRINTABLE = 0x20;
const DEL = 0x7f;

export const NOT_LOGGED_IN = 'Not logged in to emailit.io.';

/** `text` with every CRLF and lone CR made a line break. */
export const withLineBreaks = (text: string): string => text.replace(/\r\n?/g, '\n');

/** Whether `text` holds a C0 control or DEL other than a line break: a character a
 *  terminal acts on rather than prints. */
export const holdsControl = (text: string): boolean =>
  [...text].some((character) => {
    const code = character.codePointAt(0) ?? FIRST_PRINTABLE;
    return character !== '\n' && (code < FIRST_PRINTABLE || code === DEL);
  });

export const charactersIn = (text: string): number => [...text].length;

/** The store's words for writing it refused, whatever was written. */
export const STORE_REFUSALS = [
  z.object({ outcome: z.literal('login_failed') }),
  z.object({ outcome: z.literal('throttled') }),
  z.object({ outcome: z.literal('capped') }),
] as const;

/** What a refusal from the store says, naming the handle the login gave. */
export const storeRefusal = (
  outcome: z.infer<(typeof STORE_REFUSALS)[number]>['outcome'],
  handle: string,
): string => {
  if (outcome === 'login_failed') return `Login failed for ${handle}@${EMAILIT_DOMAIN}.`;
  if (outcome === 'throttled') return 'Too many failed logins. Wait a minute.';
  return 'You have posted 20 times in the last hour. Wait a while.';
};
