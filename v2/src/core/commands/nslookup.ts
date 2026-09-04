/**
 * nslookup — what is this name, and where does it point?
 *
 * The command that makes a scan's output usable. `nmap` prints `web-04` and until
 * now the player had to read the address off the same row to do anything with it;
 * this turns the name into the address, and every other network command then
 * accepts the name directly.
 *
 * The ACCESS POINT's gateway answers, which is why this needs no name server on
 * the LAN — a home router hands out the leases, so it is the box that knows what
 * everything is called. It answers for its OWN network only: a name carrying a
 * different network's domain gets the same NXDOMAIN an invented name does, because
 * there is no world DNS behind this and a player resolves what they are standing on.
 *
 * Instant, with no pacing and nothing to interrupt: the resolver already holds the
 * answer, so spending real seconds on a simulated round trip would only make the
 * player wait for a delay the game does not otherwise model.
 */

import type { Command, CommandResult } from './types';
import { generateHomeLan } from '../generation/generateHomeLan';
import { resolveName } from '../network/resolveName';
import { connectedWlan0 } from '../network/interfaces';
import { errorLine, text } from './streaming';

const error = (message: string): CommandResult => ({
  kind: 'sync',
  lines: [errorLine(message)],
  exitCode: 1,
});

const USAGE = 'nslookup: usage: nslookup <name>';

const UNREACHABLE = 'nslookup: network is unreachable — connect to a network first';

/** The standard DNS port, printed beside the resolver exactly as real `nslookup`
 *  prints it — the one place this output says which protocol answered. */
const DNS_PORT = 53;

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
  // Named before the answer is known, and printed even when the lookup fails: a
  // player who gets NXDOMAIN has still learned WHICH resolver denied them, which is
  // the first thing worth knowing when the answer is not what you expected.
  const header = [text(`Server:  ${resolver}`), text(`Address: ${resolver}#${DNS_PORT}`), text('')];

  const resolved = await resolveName({ essid, name, resolveOccupants: env.scan.resolveOccupants });
  if (resolved === null) {
    return {
      kind: 'sync',
      lines: [...header, text(`** server can't find ${name}: NXDOMAIN`)],
      exitCode: 1,
    };
  }

  return {
    kind: 'sync',
    lines: [
      ...header,
      text('Non-authoritative answer:'),
      text(`Name:    ${resolved.fqdn}`),
      text(`Address: ${resolved.ip}`),
    ],
    exitCode: 0,
  };
};

export const nslookup: Command = {
  name: 'nslookup',
  description: 'Look up the address behind a name',
  category: 'network',
  tier: 'guest',
  // Bought rather than shipped: `apt install dnsutils` puts this and `dig` in
  // /usr/bin, on the player's box or on any box they have rooted.
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'nslookup <name>',
    description:
      "Ask the network's gateway what address a name points at. Answers for the network you are connected to only — names are `<host>.<network>.lan`, and the short form works because that network is your search domain. An unknown name answers NXDOMAIN.",
    arguments: [
      { name: 'name', description: 'The host name to look up, e.g. web-04', required: true },
    ],
    examples: [
      { command: 'nslookup web-04', description: 'Resolve a host you saw in a scan' },
      {
        command: 'nslookup web-04.acme-corp.lan',
        description: 'The same lookup, fully qualified',
      },
    ],
  },
  execute,
};
