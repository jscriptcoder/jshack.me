/**
 * The operator's orders at `scripts/hireme.ts`, and the report `show` prints.
 *
 * The script stages contracts for testing — `accept` a job for a handle, `drop` the one it
 * holds, `post` a board fresh offers past the day's turnover, `show` what a number drew. It
 * never completes a job: a payout only ever goes through the real mail door. The order
 * parser refuses anything that is not exactly one of the four, so a near miss is never
 * taken for another.
 *
 * `show` is the one place a derived key is ever printed: it reads the deployment secret from
 * the environment, so only an operator can run it. The report sets the key beside the
 * address, essid, route and forward a contractor would work out for themselves from the
 * public shape, and the client, target and pay the briefing names — everything an operator
 * needs to drive a test of the network and its mail door by hand.
 */

import { missionShape } from './missionShape.js';
import { EMAILIT_DOMAIN } from '../generation/fixedSites.js';
import { missionKey, missionKeyPath } from './missionSecret.js';
import { missionAddressForNumber, missionEssid } from './missionNetwork.js';
import { missionTerms } from './missionTerms.js';

export type MissionOrder =
  | { readonly verb: 'accept'; readonly handle: string; readonly number: number | null }
  | { readonly verb: 'show'; readonly address: string }
  | { readonly verb: 'drop'; readonly handle: string }
  | { readonly verb: 'post'; readonly handle: string };

/** A chosen contract number, as `--number` spells it: a non-negative integer with no sign,
 *  no leading zero beyond zero itself, and no decimal point. Whether it names a contract is
 *  the caller's to check against `isMissionNumber`; this only rejects what is not a number. */
const NUMBER_ARG = /^(0|[1-9][0-9]*)$/;

/** What the operator typed after the script's name, or `null` when it is not exactly
 *  `accept <handle> [--number <n>]`, `show <address>`, `drop <handle>` or `post <handle>`.
 *  A handle or an
 *  address is any non-empty word that is not a flag. */
export const readMissionOrder = (words: readonly string[]): MissionOrder | null => {
  const [verb, first = '', ...rest] = words;
  const isValue = (word: string): boolean => word !== '' && !word.startsWith('--');

  if (verb === 'accept' && isValue(first)) {
    if (rest.length === 0) return { verb, handle: first, number: null };
    if (rest.length === 2 && rest[0] === '--number' && NUMBER_ARG.test(rest[1]!)) {
      return { verb, handle: first, number: Number(rest[1]) };
    }
    return null;
  }
  if (verb === 'show' && words.length === 2 && isValue(first)) {
    return { verb, address: first };
  }
  if ((verb === 'drop' || verb === 'post') && words.length === 2 && isValue(first)) {
    return { verb, handle: first };
  }
  return null;
};

/** How a service reads in the report: what it is, the release it sits on, and the port it
 *  answers. */
const serviceLine = (service: {
  readonly service: string;
  readonly package: string;
  readonly version: string;
  readonly port: number;
}): string => `    ${service.service} (${service.package} ${service.version}) :${service.port}`;

/** The multi-line report `show <address>` prints for a contract number: the address and
 *  essid it answers at, the one guaranteed route, the gateway's forward, the key box's
 *  services, and — the operator-only half — the key and the path it sits at, both derived
 *  from the deployment secret. */
export const showReport = (missionNumber: number, secret: string): string => {
  const shape = missionShape(missionNumber);
  const terms = missionTerms(missionNumber);
  const address = missionAddressForNumber(missionNumber);
  const services =
    shape.keyBoxServices.length === 0
      ? '    (none beyond the route)'
      : shape.keyBoxServices.map(serviceLine).join('\n');
  return [
    `Contract ${missionNumber} at ${address} (essid ${missionEssid(missionNumber)})`,
    `  Client:   ${terms.client.company} (${terms.client.handle}@${EMAILIT_DOMAIN})`,
    `  Target:   ${terms.targetCompany}, ${shape.stem}-gw / ${shape.stem}-files`,
    `  Pay:      ${terms.pay} JSC`,
    `  Route:    ${shape.route}`,
    `  Forward:  :${shape.forward.publicPort} -> key box :${shape.forward.internalPort}`,
    `  Services:`,
    services,
    `  Key path: ${missionKeyPath(missionNumber)}`,
    `  Key:      ${missionKey(missionNumber, secret)}`,
  ].join('\n');
};

/** The line printed once a job is accepted: the address the contract now answers at, which
 *  a test or a player it is handed to reaches it by. */
export const acceptedLine = (handle: string, missionNumber: number, address: string): string =>
  `Accepted contract ${missionNumber} for ${handle}: ${address}`;

/** The line printed once a job is dropped: the address stays reachable (the network is
 *  persistent and shared), and the handle is free to accept another. */
export const droppedLine = (handle: string, missionNumber: number, address: string): string =>
  `Dropped ${handle}'s contract ${missionNumber}; ${address} stays reachable`;
