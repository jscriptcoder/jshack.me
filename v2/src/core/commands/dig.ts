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

import type { Command, CommandResult, TerminalLine } from './types';
import { generateHomeLan } from '../generation/generateHomeLan';
import { createPrng } from '../generation/prng';
import { resolveName, type ResolvedName } from '../network/resolveName';
import { connectedWlan0 } from '../network/interfaces';
import { MONTHS } from '../logging/syslog';
import type { EpochMs } from '../types';
import { errorLine, text } from './streaming';

const error = (message: string): CommandResult => ({
  kind: 'sync',
  lines: [errorLine(message)],
  exitCode: 1,
});

const USAGE = 'dig: usage: dig <name>';

const UNREACHABLE = 'dig: network is unreachable — connect to a network first';

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

const execute: Command['execute'] = async (env, args) => {
  const name = args[0];
  if (name === undefined) {
    return error(USAGE);
  }

  const wlan0 = connectedWlan0(env.network);
  if (wlan0 === null) {
    return error(UNREACHABLE);
  }

  const essid = wlan0.association.essid;
  const resolver = `${generateHomeLan(essid).subnet}.1`;
  const resolved = await resolveName({
    essid,
    name,
    resolveOccupants: env.scan.resolveOccupants,
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
    synopsis: 'dig <name>',
    description:
      "Ask the network's gateway for the record behind a name, and print it the way a name server hands it over — name, TTL, class, type and address — with the resolver that answered and how long it took. Answers for the network you are connected to only. An unknown name reports NXDOMAIN.",
    arguments: [
      { name: 'name', description: 'The host name to look up, e.g. web-04', required: true },
    ],
    examples: [
      { command: 'dig web-04', description: 'Look up a host you saw in a scan' },
      { command: 'dig web-04.acme-corp.lan', description: 'The same lookup, fully qualified' },
    ],
  },
  execute,
};
