/**
 * A handle's contractor board, answered by the boards' server at the board's address.
 *
 * SERVER ONLY by discipline: it shows the contracts' terms, which are the server's prose,
 * so only the server's fetch handler imports it (hireme.io's own pages ship in the bundle,
 * since its front page is a file in its tree).
 *
 * The board shows the current contract, if one is held, then the offers. Neither ever shows
 * a mission's address: an offer is not reachable until it is accepted, and an accepted one's
 * address goes only into the handle's inbox, so a leaked board says who you work for and
 * against whom, never where. An offer is named by its ref, which its Accept form posts in a
 * hidden field; the ref shows on the page too, for a contractor accepting with curl.
 *
 * What a form just did is said once, under the button it answers. When that button is no
 * longer on the page (the offer turned over, the contract was dropped), it is said at the
 * top instead.
 */

import { escapeHtml } from '../findit/page.js';
import { writeAmount } from '../wallet/amount.js';
import { hiremePage } from './pages.js';
import type { MissionTerms } from '../missions/missionTerms.js';

export type BoardOffer = {
  readonly ref: string;
  readonly terms: MissionTerms;
};

/** What a form just did, and the button it answers: an offer's Accept, by its ref, or the
 *  current contract's Drop. */
export type BoardNotice = {
  readonly message: string;
  readonly under: { readonly offer: string } | 'contract';
};

export type ContractBoard = {
  readonly handle: string;
  /** The board's own address, for the curl lines. */
  readonly address: string;
  readonly current: MissionTerms | null;
  readonly offers: readonly BoardOffer[];
  readonly notice?: BoardNotice;
};

const alert = (message: string): string => `<p role="alert">${escapeHtml(message)}</p>`;

const isUnderOffer = (notice: BoardNotice | undefined, ref: string): notice is BoardNotice =>
  notice !== undefined && notice.under !== 'contract' && notice.under.offer === ref;

/** Whether the button the notice answers is on this board. */
const hasItsButton = (board: ContractBoard, notice: BoardNotice): boolean =>
  notice.under === 'contract'
    ? board.current !== null
    : board.offers.some((offer) => isUnderOffer(notice, offer.ref));

const currentContract = (board: ContractBoard, current: MissionTerms): readonly string[] => [
  '<h2>Current contract</h2>',
  `<p>${escapeHtml(`${current.client.company} — ${current.targetCompany} — ${writeAmount(current.pay)}`)}</p>`,
  '<form action="/drop" method="post">',
  '<input type="hidden" name="confirm" value="yes">',
  '<p><input type="submit" value="Drop contract"></p>',
  '</form>',
  ...(board.notice?.under === 'contract' ? [alert(board.notice.message)] : []),
  '<p>Or from a terminal:</p>',
  '<pre>',
  escapeHtml(`$ curl -d "confirm=yes" http://${board.address}/drop`),
  '</pre>',
];

const offerBlock = (board: ContractBoard, { ref, terms }: BoardOffer): readonly string[] => [
  `<p>${escapeHtml(`${terms.client.company} — ${terms.kind} — ${writeAmount(terms.pay)}`)}</p>`,
  `<p>${escapeHtml(terms.pitch)}</p>`,
  `<p>Ref: ${escapeHtml(ref)}</p>`,
  '<form action="/accept" method="post">',
  `<input type="hidden" name="offer" value="${escapeHtml(ref)}">`,
  '<p><input type="submit" value="Accept"></p>',
  '</form>',
  ...(isUnderOffer(board.notice, ref) ? [alert(board.notice.message)] : []),
];

export const contractBoardPage = (board: ContractBoard): string => {
  const { notice, current } = board;
  const atTop = notice !== undefined && !hasItsButton(board, notice);
  return hiremePage('hireme.io - contractor board', [
    `<h1>Welcome back, ${escapeHtml(board.handle)}.</h1>`,
    ...(atTop ? [alert(notice.message)] : []),
    ...(current === null ? [] : currentContract(board, current)),
    '<h2>Offers</h2>',
    ...board.offers.flatMap((offer) => offerBlock(board, offer)),
    '<p>Or from a terminal:</p>',
    '<pre>',
    escapeHtml(`$ curl -d "offer=<ref>" http://${board.address}/accept`),
    '</pre>',
  ]);
};
