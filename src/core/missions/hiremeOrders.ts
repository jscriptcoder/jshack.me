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

import { missionShape, type MissionBox, type MissionBoxRef } from './missionShape.js';
import { FRONT_BOX_SUFFIX, GATEWAY_SUFFIX, KEY_BOX_SUFFIX } from './pools.js';
import { EMAILIT_DOMAIN } from '../generation/fixedSites.js';
import { missionKeyFilePath, missionLeakPath, missionLeakWord } from './missionLeak.js';
import { missionKey, missionPassphrase } from './missionSecret.js';
import { missionAddressForNumber, missionEssid } from './missionNetwork.js';
import { missionTerms } from './missionTerms.js';
import { missionRecords } from './missionRecords.js';
import { DATADIR_PATH } from '../mysql/datadir.js';
import { writeAmount } from '../wallet/amount.js';

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

const decoyTag = (isDecoy: boolean): string => (isDecoy ? ' (decoy)' : '');

/** The lines `show` adds on a route that leaks a word, at `indent`. Reading the word needs the
 *  pools, so the report says when they are missing rather than failing the whole of `show`. */
const leakLines = (
  ref: MissionBoxRef,
  rawSecrets: string | undefined,
  indent: string,
): readonly string[] => {
  const path = missionLeakPath(ref);
  if (path === null) return [];
  const word = rawSecrets === undefined ? undefined : missionLeakWord(ref, rawSecrets);
  return [
    `${indent}Leak:     ${path}`,
    `${indent}Word:     ${word ?? '(JSHACK_SECRETS is not set)'}`,
  ];
};

/** A box's services as the report lists them, at `indent`: each with its release and port,
 *  a decoy's tagged. */
const serviceLines = (box: MissionBox, decoyPorts: readonly number[], indent: string) => [
  `${indent}Services:`,
  ...box.services.map(
    (service) =>
      `${indent}  ${service.service} (${service.package} ${service.version}) :${service.port}` +
      decoyTag(decoyPorts.includes(service.port)),
  ),
];

/** How the key is stored, with what the operator needs to reach it: the passphrase that opens
 *  a sealed key, the table a database keeps it in. */
const storageDetail = (missionNumber: number, secret: string): string => {
  const { storage } = missionShape(missionNumber);
  if (storage === 'gpg') return `gpg, passphrase ${missionPassphrase(missionNumber, secret)}`;
  return storage === 'database' ? 'database, table api_keys' : storage;
};

/** What a tamper job is, as the report names it: its kind, its setting and its action. */
const TAMPER_KIND = 'tamper, school, change';

/** Where a tamper job's records are kept and the one change it asks, where a key job's storage,
 *  key path and key go. */
const recordLines = (missionNumber: number): readonly string[] => {
  const { target } = missionRecords(missionNumber);
  return [
    '  Storage:  database, table grades',
    `  Records:  ${DATADIR_PATH}`,
    `  Change:   ${target.student}, ${target.subject}: ${target.from} -> ${target.to}`,
  ];
};

/** The multi-line report `show <address>` prints for a contract number: the address and
 *  essid it answers at, its template, the gateway's forwards naming the box they reach, each
 *  box's route and services, and — the operator-only half — how the key is stored, the key and
 *  the file it is in (with the passphrase that opens it on a gpg contract), and on each leak
 *  route the file and the word in it, all derived from the deployment's secrets. A two-hop
 *  contract gives each box a section of its own, the front box's first, as the way in runs. */
export const showReport = (
  missionNumber: number,
  secret: string,
  rawSecrets: string | undefined,
): string => {
  const shape = missionShape(missionNumber);
  const terms = missionTerms(missionNumber);
  const address = missionAddressForNumber(missionNumber);
  const { keyBox, frontBox } = shape;
  const keyRef = { missionNumber, role: 'key' } as const;
  // The gateway forwards onto one box, whose decoys follow its real forwards, so the tail of
  // the list is theirs; a service is a decoy's when it answers on a decoy's port.
  const entry = frontBox ?? keyBox;
  const realForwardCount = shape.forwards.length - entry.decoys.length;
  const decoyPorts = shape.forwards.slice(realForwardCount).map(({ internalPort }) => internalPort);
  // A two-hop key box's decoys have no forwards: each runs a daemon after its real doors.
  const insideDecoyPorts = keyBox.services
    .slice(keyBox.services.length - keyBox.decoys.length)
    .map(({ port }) => port);
  const reached = frontBox === null ? 'key box' : 'front box';
  const keyLines =
    shape.kind === 'tamper'
      ? recordLines(missionNumber)
      : [
          `  Storage:  ${storageDetail(missionNumber, secret)}`,
          `  Key path: ${missionKeyFilePath(missionNumber)}`,
          `  Key:      ${missionKey(missionNumber, secret)}`,
        ];
  const boxes =
    frontBox === null
      ? [
          ...serviceLines(keyBox, decoyPorts, '  '),
          ...keyLines,
          ...leakLines(keyRef, rawSecrets, '  '),
        ]
      : [
          `  Front box: ${shape.stem}-${FRONT_BOX_SUFFIX}`,
          `    Route:    ${frontBox.route}`,
          ...serviceLines(frontBox, decoyPorts, '    '),
          ...leakLines({ missionNumber, role: 'front' }, rawSecrets, '    '),
          `  Key box:   ${shape.stem}-${KEY_BOX_SUFFIX}`,
          `    Route:    ${keyBox.route}`,
          ...serviceLines(keyBox, insideDecoyPorts, '    '),
          ...leakLines(keyRef, rawSecrets, '    '),
          ...keyLines,
        ];
  const hosts = [GATEWAY_SUFFIX, ...(frontBox === null ? [] : [FRONT_BOX_SUFFIX]), KEY_BOX_SUFFIX];
  return [
    `Contract ${missionNumber} at ${address} (essid ${missionEssid(missionNumber)})`,
    `  Client:   ${terms.client.company} (${terms.client.handle}@${EMAILIT_DOMAIN})`,
    `  Target:   ${terms.targetCompany}, ${hosts.map((suffix) => `${shape.stem}-${suffix}`).join(' / ')}`,
    `  Pay:      ${writeAmount(terms.pay)}`,
    `  Template: ${frontBox === null ? 'single-hop' : 'two-hop'}`,
    ...(shape.kind === 'tamper' ? [`  Kind:     ${TAMPER_KIND}`] : []),
    // One box needs no section, so its route heads the report as it always has.
    ...(frontBox === null ? [`  Route:    ${keyBox.route}`] : []),
    ...shape.forwards.map(
      (forward, index) =>
        `  Forward:  :${forward.publicPort} -> ${reached} :${forward.internalPort}` +
        decoyTag(index >= realForwardCount),
    ),
    ...boxes,
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
