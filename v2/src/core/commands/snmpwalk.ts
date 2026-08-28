/**
 * snmpwalk — ask a network device what it is.
 *
 * The sixth door, and the first that opens onto something other than a box you can
 * stand on. `ssh`, `ftp` and `mysql` put you somewhere; this one never does. It reads a
 * device and, with a community string somebody had to crack, rewrites what that device
 * DOES — all of it without a shell, an account, or a session anyone could end.
 *
 * The read-only tier is deliberately shallow: a name, a platform, a contact, and the
 * addresses the device holds. Not one port it forwards. A player who walks their
 * gateway with `public` learns there is a device here worth a wordlist, and nothing
 * they can act on yet — which is the whole job of this tier.
 *
 * EVERY failure is one message. A device that is not there, a device whose agent was
 * stopped, and a device that refused the community all read `Timeout: No Response from
 * <host>`, because that is what a real agent's silence produces and because told apart
 * they would let a sweep sort devices into worth-cracking and not before spending a
 * word of a wordlist. The server keeps the distinction — the log it writes has to.
 *
 * There is NO client pre-flight, unlike `redis-cli`'s. That door pre-flights to save a
 * round trip on a refusal it can settle from the world it regenerates; here every
 * refusal is the same sentence, so a pre-flight would duplicate the generated world on
 * the client to arrive at a message the server was going to send anyway.
 */

import { connectedWlan0 } from '../network/interfaces';
import { renderIdentityWalk, renderReadWriteWalk } from '../snmp/walk';
import { errorLine, text } from './streaming';
import type { Command, CommandResult } from './types';

const USAGE = 'usage: snmpwalk <host> [community]';

/** The community every agent answers a read-only walk to, and the one a player gets
 *  without asking. Real SNMP's own default, and the actual joke of the protocol: the
 *  read-only string is not a secret and never was. Defaulting it makes the first walk
 *  free, which is what turns `161/udp` on a scan into something a player tries. */
const DEFAULT_COMMUNITY = 'public';

const errorResult = (content: string): CommandResult => ({
  kind: 'sync',
  lines: [errorLine(content)],
  exitCode: 1,
});

const execute: Command['execute'] = async (env, args) => {
  const [target, community] = args;
  if (target === undefined) return errorResult(USAGE);

  const wlan0 = connectedWlan0(env.network);
  if (wlan0 === null) return errorResult(`snmpwalk: ${target}: Network is unreachable`);

  const asked = community ?? DEFAULT_COMMUNITY;
  const walked = await env.snmp.walk({
    essid: wlan0.association.essid,
    targetIp: target,
    community: asked,
    sourceIp: wlan0.ipv4,
  });

  // The real tool's own words for an agent that said nothing back. It is the truth for
  // a box that is not there and a lie of omission for one that refused you — which is
  // exactly what a silent agent leaves you to work out for yourself.
  if (!walked.ok) return errorResult(`Timeout: No Response from ${target}`);

  // Two renders, picked by the tier the SERVER named — never by whether a port table
  // arrived. An empty table is what a default-deny router honestly has, and inferring
  // the tier from its emptiness would print a refusal to a player whose community
  // worked.
  const lines =
    walked.tier === 'read-only'
      ? renderIdentityWalk({ target, community: asked, identity: walked.identity })
      : renderReadWriteWalk({
          target,
          community: asked,
          identity: walked.identity,
          portTable: walked.portTable,
        });

  return { kind: 'sync', lines: lines.map(text), exitCode: 0 };
};

export const snmpwalk: Command = {
  name: 'snmpwalk',
  description: 'Read a network device over SNMP',
  category: 'network',
  tier: 'guest',
  availability: { kind: 'installed-package', packageName: 'snmp' },
  manual: {
    synopsis: 'snmpwalk <host> [community]',
    description:
      'Ask a network device — a router or a switch — what it is, over SNMP. No login ' +
      'and no account: an agent answers to a COMMUNITY STRING, which belongs to the ' +
      'device rather than to a person. Every agent answers to "public", which is what ' +
      'this uses when you name none, and "public" returns identity only: the name, the ' +
      'platform, a contact and the addresses the device holds. A READ-WRITE community ' +
      'returns its port table as well, and one of those has to be recovered with ' +
      '"hydra <host> snmp". A device that is not there, one whose agent has been ' +
      'stopped, and one that refused your community all answer the same way — silence. ' +
      "Your walk is recorded in the device's own /var/log/snmpd.log either way.",
    arguments: [
      { name: 'host', description: 'The device to walk, e.g. 10.0.0.1', required: true },
      {
        name: 'community',
        description: 'The community string to ask with (default: public)',
      },
    ],
    examples: [
      { command: 'snmpwalk 10.0.0.1', description: 'Ask the gateway what it is' },
      {
        command: 'snmpwalk 10.0.0.1 corpnet',
        description: 'Ask with a community string you recovered',
      },
    ],
  },
  execute,
};
