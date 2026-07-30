/**
 * ping — is anything at this address?
 *
 * The cheapest question a player can ask the network, and the one that comes before
 * `nmap`: reachability alone, with no regard for what the host runs. An address that
 * never answers is not worth scanning; one that answers but shows no ports is a box
 * running nothing, which is a different and more interesting fact.
 *
 * Round-trip times are SEEDED from the address, so a host reports the same latency
 * every time. A shimmering number would read as noise; a stable one reads as a
 * property of the host, which is what a player can then notice changing.
 *
 * Reachability is the LAN's own question, so it resolves entirely client-side from
 * the generated network plus the player's own lease. Reaching across networks by
 * public IP is a server round-trip and belongs with the cross-player slice.
 */

import type { Command, CommandEnv, CommandResult, TerminalLine } from './types';
import { generateHomeLan } from '../generation/generateHomeLan';
import { withSelfHost } from '../network/mergeLanOccupants';
import { assignHomeNetwork } from '../network/homeNetwork';
import { createPrng } from '../generation/prng';
import { errorLine, streamedResult, text } from './streaming';

const error = (message: string): CommandResult => ({
  kind: 'sync',
  lines: [errorLine(message)],
  exitCode: 1,
});

const USAGE = 'ping: usage: ping <host> [count]';

const UNREACHABLE = 'ping: network is unreachable — connect to a network first';

/** ICMP echo payload sizes, as real `ping` reports them. */
const PAYLOAD_BYTES = 56;
const REPLY_BYTES = 64;

const DEFAULT_COUNT = 4;
/** A ceiling so a mistyped count cannot stall the terminal for minutes. */
const MAX_COUNT = 20;

const TTL = 64;

/** Pause between echoes, so the replies arrive one at a time rather than at once. */
const INTERVAL_MS = 300;

/** The round-trip time for one echo — seeded per (address, sequence), so a host's
 *  latency is a stable property of that host rather than fresh noise each run. */
const replyTimeMs = (ip: string, sequence: number): string =>
  (0.2 + createPrng(`ping-${ip}-${sequence}`).next() * 1.8).toFixed(3);

/** The optional `[count]` as a positive whole number, the default when absent, or
 *  null when it is not a count at all. */
const parseCount = (raw: string | undefined): number | null => {
  if (raw === undefined) return DEFAULT_COUNT;
  const count = Number(raw);
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) return null;
  return count;
};

async function* echoes(
  env: CommandEnv,
  target: string,
  count: number,
  reachable: boolean,
): AsyncGenerator<TerminalLine, number> {
  yield text(`PING ${target} (${target}) ${PAYLOAD_BYTES}(${PAYLOAD_BYTES + 28}) bytes of data.`);

  for (let sequence = 1; sequence <= count; sequence++) {
    await env.sleep(INTERVAL_MS);
    if (reachable) {
      yield text(
        `${REPLY_BYTES} bytes from ${target}: icmp_seq=${sequence} ttl=${TTL} time=${replyTimeMs(target, sequence)} ms`,
      );
    }
  }

  const received = reachable ? count : 0;
  const loss = Math.round(((count - received) / count) * 100);
  yield text('');
  yield text(`--- ${target} ping statistics ---`);
  yield text(`${count} packets transmitted, ${received} received, ${loss}% packet loss`);
  return received > 0 ? 0 : 1;
}

const execute: Command['execute'] = async (env, args) => {
  const target = args[0];
  if (target === undefined) {
    return error(USAGE);
  }

  const count = parseCount(args[1]);
  if (count === null) {
    return error(`ping: bad number of packets to transmit: ${args[1]}`);
  }

  if (!env.network.isOnline()) {
    return error(UNREACHABLE);
  }
  const wlan0 = env.network.interfaces().find((iface) => iface.name === 'wlan0');
  if (
    wlan0 === undefined ||
    wlan0.kind !== 'wireless' ||
    wlan0.association === null ||
    wlan0.ipv4 === null
  ) {
    return error(UNREACHABLE);
  }

  const essid = wlan0.association.essid;
  // The player's own address is part of the LAN they can reach — pinging yourself is
  // how you check your own stack before blaming the network.
  const lan = withSelfHost(
    generateHomeLan(essid),
    wlan0.ipv4,
    assignHomeNetwork(env.identity.publicKeyHex, essid).hostname,
  );
  const reachable = lan.hosts.some((host) => host.ip === target);

  // The exit code IS the answer here (0 only when something replied), so it comes from
  // the stream's own return value rather than being assumed up front.
  return streamedResult(echoes(env, target, count, reachable));
};

export const ping: Command = {
  name: 'ping',
  description: 'Check whether a host is reachable',
  category: 'network',
  tier: 'guest',
  // Ships in /bin on every box, so reachability can be checked from wherever the
  // player currently stands.
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'ping <host> [count]',
    description:
      'Send ICMP echo requests to a host on your network and report which came back. Answers reachability only — a host that replies may still be running nothing. Sends 4 packets by default.',
    arguments: [
      { name: 'host', description: 'The address to reach, e.g. 192.168.1.5', required: true },
      { name: 'count', description: `How many packets to send (1-${MAX_COUNT}, default 4)` },
    ],
    examples: [
      { command: 'ping 192.168.1.5', description: 'Send four echo requests to a host' },
      { command: 'ping 192.168.1.5 2', description: 'Send just two' },
    ],
  },
  execute,
};
