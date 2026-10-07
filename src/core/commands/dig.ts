/**
 * dig — the same question `nslookup` asks, in the form the tool most people reach
 * for actually answers it.
 *
 * One resolver stands behind both, so the two commands can never disagree about
 * where a name points; what differs is the shape of the answer. `dig` prints the
 * record itself — name, TTL, class, type, address — and then the provenance a
 * player checking their own work wants: which resolver replied, and when.
 *
 * The query time is REPORTED rather than SPENT. The answer is already here, so
 * pacing the command would only make the player wait out a delay the game does not
 * model; seeding the number off the name keeps it a stable property of that lookup
 * instead of fresh noise on every run.
 */

import type { Command, CommandEnv, CommandResult, TerminalLine } from './types.js';
import { zoneRecordsFor, allowsZoneTransfer, nameServerStandsAt } from '../generation/generateDnsZone.js';
import { createPrng } from '../generation/prng.js';
import { resolveName, lanZoneName, type ResolvedName } from '../network/resolveName.js';
import { resolverFor, vantageOf, type Vantage } from '../network/vantage.js';
import { MONTHS } from '../logging/syslog.js';
import type { EpochMs } from '../types.js';
import { errorLine, text } from './streaming.js';

const error = (message: string): CommandResult => ({
  kind: 'sync',
  lines: [errorLine(message)],
  exitCode: 1,
});

const USAGE = 'dig: usage: dig <name>';

const UNREACHABLE = 'dig: network is unreachable — connect to a network first';

/** The keyword that turns `dig` from a lookup into a zone transfer, matched
 *  case-insensitively the way real `dig` reads it. */
const AXFR_KEYWORD = 'axfr';

/** A dotted quad, so the server to transfer FROM is recognised as `@10.0.0.1` or
 *  `10.0.0.1` wherever it sits in the argument list. */
const IPV4 = /^\d+\.\d+\.\d+\.\d+$/;

const AXFR_USAGE = 'dig: usage: dig @<server> axfr';

/** The version this build reports itself as. Fixed rather than drawn: a tool that
 *  claimed a different version each run would be the strangest box on the network. */
const DIG_VERSION = '9.16.0';

const DNS_PORT = 53;

/** The lifetime every record here claims. One hour, uniformly — these names come
 *  from the network's own generator rather than from a zone somebody edits, so
 *  there is nothing for a shorter or longer TTL to mean yet. */
const RECORD_TTL = 3600;

/** Width the record name is padded to before the TTL column, as real `dig` aligns
 *  it. A name longer than the column simply takes the space it needs. */
const NAME_COLUMN = 23;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** `dig`'s own timestamp shape — `Tue Nov 14 22:13:20 UTC 2023`. UTC, like every
 *  other clock the game prints, so two players comparing notes read one time. */
const formatWhen = (time: EpochMs): string => {
  const date = new Date(time);
  const pad = (value: number): string => value.toString().padStart(2, '0');
  const clock = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
  return `${DAYS[date.getUTCDay()]} ${MONTHS[date.getUTCMonth()]} ${pad(date.getUTCDate())} ${clock} UTC ${date.getUTCFullYear()}`;
};

/** How long this lookup will claim to have taken. Seeded from the name so it is the
 *  same on every run, and small because the resolver is one hop away on the LAN. */
const queryTimeMsec = (name: string): number => createPrng(`dig-${name}`).nextInt(1, 8);

const answerLine = ({ fqdn, ip }: ResolvedName): string =>
  `${`${fqdn}.`.padEnd(NAME_COLUMN)} ${RECORD_TTL}  IN    A     ${ip}`;

/** How long a transfer will claim to have taken. Seeded off the network and the
 *  server and NOTHING else, so two occupants of one access point read the same
 *  number and a re-run never shimmers — the value is a property of the transfer,
 *  not of who ran it. Small, because the zone is a local file and not a recursion. */
const axfrQueryTimeMsec = (essid: string, ip: string): number =>
  createPrng(`dig-axfr-${essid}-${ip}`).nextInt(1, 8);

/** The server a transfer names — pulled out of the arguments wherever it sits, its
 *  `@` prefix stripped — and whether `axfr` was asked for at all. `null` when it was
 *  not, so the caller falls through to an ordinary lookup and nothing about
 *  `dig <name>` changes. */
const parseAxfr = (args: readonly string[]): { readonly server: string | undefined } | null => {
  if (!args.some((arg) => arg.toLowerCase() === AXFR_KEYWORD)) return null;
  const server = args
    .map((arg) => (arg.startsWith('@') ? arg.slice(1) : arg))
    .find((arg) => IPV4.test(arg));
  return { server };
};

/** Transfer `server`'s zone: the whole address plan — every configured host on the
 *  LAN and every host on the layers behind it — read out of generation and handed
 *  over, unless the server's `allow-transfer` is closed. Instant: the zone is a
 *  file, and a real transfer of a dozen records is milliseconds. */
const reachesNameServer = (vantage: Vantage, server: string): boolean =>
  vantage.reaches.some((segment) => server.startsWith(`${segment.subnet}.`)) &&
  nameServerStandsAt(vantage.essid, server);

const transferZone = (env: CommandEnv, server: string | undefined): CommandResult => {
  const vantage = vantageOf(env.session, env.network);
  if (vantage === null) {
    return error(UNREACHABLE);
  }
  if (server === undefined) {
    return error(AXFR_USAGE);
  }

  const essid = vantage.essid;
  // A name server the box cannot reach — on a segment this vantage does not touch, or
  // with no name server there at all — is refused the same way: from where you stand
  // there is nothing to transfer from.
  if (!reachesNameServer(vantage, server)) {
    return error(`dig: ${server}: no DNS service on target`);
  }

  // A real transfer or a real refusal — a name server stands here either way — so tell
  // it, and it leaves a `/var/log/named.log` line naming whoever ran this. Fire-and-
  // forget and best-effort: the payout below is byte-for-byte the same whether the
  // trace lands or the notify fails, and an ordinary lookup never reaches this branch.
  void env.scan
    .recordZoneTransfer({ essid, serverIp: server, callerMachineId: env.session.machineId })
    .catch(() => undefined);

  const zone = lanZoneName(essid);
  const records = zoneRecordsFor(essid);
  const open = allowsZoneTransfer(essid, server);

  // Open hands the whole zone over and reports its size; closed says only that it
  // refused. Real `dig` prints the server and the time in either case.
  const body: readonly TerminalLine[] = open
    ? [
        text(';; ANSWER SECTION:'),
        ...records.map((record) =>
          text(answerLine({ fqdn: `${record.name}.${zone}`, ip: record.ip })),
        ),
        text(''),
        text(`;; XFR size: ${records.length} records`),
        text(`;; Query time: ${axfrQueryTimeMsec(essid, server)} msec`),
      ]
    : [text('; Transfer failed.')];

  return {
    kind: 'sync',
    lines: [
      text(`; <<>> DiG ${DIG_VERSION} <<>> AXFR @${server}`),
      text(';; global options: +cmd'),
      text(''),
      ...body,
      text(`;; SERVER: ${server}#${DNS_PORT}`),
      text(`;; WHEN: ${formatWhen(env.now())}`),
    ],
    exitCode: open ? 0 : 1,
  };
};

const execute: Command['execute'] = async (env, args) => {
  const transfer = parseAxfr(args);
  if (transfer !== null) {
    return transferZone(env, transfer.server);
  }

  const name = args[0];
  if (name === undefined) {
    return error(USAGE);
  }

  const vantage = vantageOf(env.session, env.network);
  if (vantage === null) {
    return error(UNREACHABLE);
  }

  const essid = vantage.essid;
  const resolver = resolverFor(vantage);
  const resolved = await resolveName({
    essid,
    name,
    resolveOccupants: (scanned) => env.scan.resolveOccupants(scanned, env.session.machineId),
  });

  // The answer section is the only part a miss drops. Everything else — what was
  // asked, who was asked, how long they took — is what makes a failed lookup worth
  // reading, and real `dig` prints it either way.
  const answer: readonly TerminalLine[] =
    resolved === null
      ? [text(';; status: NXDOMAIN')]
      : [text(';; ANSWER SECTION:'), text(answerLine(resolved))];

  return {
    kind: 'sync',
    lines: [
      text(`; <<>> DiG ${DIG_VERSION} <<>> ${name}`),
      text(';; global options: +cmd'),
      text(''),
      ...answer,
      text(''),
      text(`;; Query time: ${queryTimeMsec(name)} msec`),
      text(`;; SERVER: ${resolver}#${DNS_PORT}`),
      text(`;; WHEN: ${formatWhen(env.now())}`),
    ],
    exitCode: resolved === null ? 1 : 0,
  };
};

export const dig: Command = {
  name: 'dig',
  description: 'Query DNS for the record behind a name',
  category: 'network',
  tier: 'guest',
  // Bought rather than shipped: `apt install dnsutils` puts this and `nslookup` in
  // /usr/bin, on the player's box or on any box they have rooted.
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'dig <name> | dig @<server> axfr',
    description:
      "Ask the network's gateway for the record behind a name, and print it the way a name server hands it over — name, TTL, class, type and address — with the resolver that answered and how long it took. Given @<server> and axfr, transfer that name server's whole zone instead: every host it is authoritative for, on this network's own segments and the layers behind them — unless the server refuses, or you cannot reach it from where you stand. Answers for the network you are on — your own at home, or the network of a box you have a shell on. An unknown name reports NXDOMAIN.",
    arguments: [
      { name: 'name', description: 'The host name to look up, e.g. web-04' },
      {
        name: '@<server>',
        description: 'The name server to transfer a zone from, e.g. @192.168.4.12',
      },
      { name: 'axfr', description: 'Request a zone transfer from @<server>' },
    ],
    examples: [
      { command: 'dig web-04', description: 'Look up a host you saw in a scan' },
      { command: 'dig web-04.acme-corp.lan', description: 'The same lookup, fully qualified' },
      { command: 'dig @192.168.4.12 axfr', description: "Transfer a name server's whole zone" },
    ],
  },
  execute,
};
