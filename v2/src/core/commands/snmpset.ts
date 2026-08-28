/**
 * snmpset — change what a network device DOES, without ever standing on it.
 *
 * The payoff of the whole door. `snmpwalk` told the player a gateway exists and, once
 * they cracked its read-write community, which ports it publishes and where they land.
 * This opens one. No login, no session, no shell — and nothing to `exit` from, because
 * there was never anywhere to be.
 *
 * The assignment travels to the agent AS TYPED. This command does not know what a
 * forward is and must not learn: the grammar and every refusal belong to the server,
 * because a client that parsed them would be a second authority on what a rule is —
 * standing beside the file's own parser — and a client that could be told what to send.
 * The one thing checked here is whether the player handed over an assignment at all,
 * which is argument shape rather than grammar, and saves a round trip on a typo.
 *
 * TWO failure shapes, and the difference is what the player has already proved. Before
 * the community is accepted there is only silence, exactly as a walk reports it: a
 * device that is not there, one whose agent was stopped, and one that refused the
 * string are one timeout, and told apart they would map which devices are worth a
 * wordlist. After it is accepted the device answers in net-snmp's own error frame and
 * names the constraint — the player holds a working string, and on the one door whose
 * whole promise is the write, silence would leave them unable to tell a bad value from
 * a working one without walking the device again.
 */

import { connectedWlan0 } from '../network/interfaces';
import { renderSetEcho, renderSetRefusal } from '../snmp/set';
import { parseAgentAddress } from '../snmp/agentAddress';
import { errorLine, text } from './streaming';
import type { Command, CommandResult } from './types';

const USAGE = 'usage: snmpset <host>[:<port>] <community> <oid>=<value>';

const errorResult = (content: string): CommandResult => ({
  kind: 'sync',
  lines: [errorLine(content)],
  exitCode: 1,
});

const execute: Command['execute'] = async (env, args) => {
  const [target, community, assignment] = args;
  if (target === undefined || community === undefined || assignment === undefined) {
    return errorResult(USAGE);
  }
  // Argument SHAPE, not grammar: whether the OID exists and whether the value is any
  // good are the agent's to say, and it is the only thing that may say them.
  if (!assignment.includes('=')) return errorResult(USAGE);

  const wlan0 = connectedWlan0(env.network);
  if (wlan0 === null) return errorResult(`snmpset: ${target}: Network is unreachable`);

  const applied = await env.snmp.set({
    essid: wlan0.association.essid,
    ...parseAgentAddress(target),
    community,
    assignment,
    sourceIp: wlan0.ipv4,
  });

  if (!applied.ok) {
    return applied.refusal === null
      ? errorResult(`Timeout: No Response from ${target}`)
      : { kind: 'sync', lines: renderSetRefusal(applied.refusal).map(errorLine), exitCode: 1 };
  }

  return { kind: 'sync', lines: renderSetEcho(applied).map(text), exitCode: 0 };
};

export const snmpset: Command = {
  name: 'snmpset',
  description: 'Reconfigure a network device over SNMP',
  category: 'network',
  tier: 'guest',
  availability: { kind: 'installed-package', packageName: 'snmp' },
  manual: {
    synopsis: 'snmpset <host>[:<port>] <community> <oid>=<value>',
    description:
      'Change one setting on a network device over SNMP. This needs a READ-WRITE ' +
      'community string — the free "public" one only reads — and one of those has to ' +
      'be recovered with "hydra <host> snmp". Walk the device first: a read-write walk ' +
      'prints its port table, and every line of that table is an OID you can set here. ' +
      'The value names the STATE the port should be left in, never an action. On a ' +
      'router, "natForward.<port>=<ip>:<port>" publishes an internal host on that ' +
      'public port and "natForward.<port>=none" stops publishing it; the destination ' +
      "must be on the device's own segment. On a switch, \"aclPort.<port>=deny\" blocks " +
      'a port behind it and "aclPort.<port>=permit" re-opens it. Setting a port that ' +
      'already carries a forward replaces it. Every set you make is recorded in the ' +
      "device's own /var/log/snmpd.log, naming the OID, both values and where you " +
      'came from.',
    arguments: [
      { name: 'host', description: 'The device to reconfigure, e.g. 10.0.0.1', required: true },
      {
        name: 'community',
        description: 'A read-write community string for the device',
        required: true,
      },
      {
        name: 'oid=value',
        description: 'The setting to change, e.g. natForward.2222=10.0.0.10:22',
        required: true,
      },
    ],
    examples: [
      {
        command: 'snmpset 10.0.0.1 corpnet natForward.2222=10.0.0.10:22',
        description: 'Publish an internal box on port 2222',
      },
      {
        command: 'snmpset 10.0.0.1 corpnet natForward.2222=none',
        description: 'Stop publishing that port',
      },
      {
        command: 'snmpset 10.0.0.9 corpnet aclPort.8080=permit',
        description: 'Re-open a port a switch was blocking',
      },
    ],
  },
  execute,
};
