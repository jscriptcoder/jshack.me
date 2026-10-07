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
 * It asks from the box the shell stands on (`vantageOf`): the player's own lease at
 * home, the hop's place on its network inside a remote shell. Reachability is that
 * network's own question, so it resolves client-side from what the box reaches — the
 * generated hosts of every segment it reaches, the deep layer it stands on, and the
 * fellow players on its LAN. Reaching across networks by public IP is a server
 * round-trip and belongs with the cross-player slice.
 */

import type { Command, CommandEnv, CommandResult, TerminalLine } from './types.js';
import { generateHomeLan } from '../generation/generateHomeLan.js';
import { createPrng } from '../generation/prng.js';
import { errorLine, streamedResult, text } from './streaming.js';
import { vantageOf, type Vantage } from '../network/vantage.js';
import { addressForTarget } from '../network/resolveName.js';
import { resolveDeepScanHosts } from '../scan/deepScanHosts.js';
import type { OccupantProjection } from '../network/resolveOccupants.js';

const error = (message: string): CommandResult => ({
  kind: 'sync',
  lines: [errorLine(message)],
  exitCode: 1,
});

const USAGE = 'ping: usage: ping <host>';

const UNREACHABLE = 'ping: network is unreachable — connect to a network first';

/** ICMP echo payload sizes, as real `ping` reports them. */
const PAYLOAD_BYTES = 56;
const REPLY_BYTES = 64;

/** How many echoes every run sends. Fixed rather than a `[count]` argument: a bare
 *  number after the host would be the only positional in the game whose meaning a
 *  player could not read off the line, and nothing here needs a different number. */
const ECHO_COUNT = 4;

const TTL = 64;

/** Pause between echoes, so the replies arrive one at a time rather than at once. */
const INTERVAL_MS = 300;

/** The round-trip time for one echo — seeded per (address, sequence), so a host's
 *  latency is a stable property of that host rather than fresh noise each run. */
const replyTimeMs = (ip: string, sequence: number): string =>
  (0.2 + createPrng(`ping-${ip}-${sequence}`).next() * 1.8).toFixed(3);

/** Echoes `address`, under the name the player typed — real `ping` heads its output
 *  and its statistics with what was asked for, and replies come from the address. */
async function* echoes(
  env: CommandEnv,
  target: string,
  address: string,
  reachable: boolean,
): AsyncGenerator<TerminalLine, number> {
  yield text(`PING ${target} (${address}) ${PAYLOAD_BYTES}(${PAYLOAD_BYTES + 28}) bytes of data.`);

  for (let sequence = 1; sequence <= ECHO_COUNT; sequence++) {
    await env.sleep(INTERVAL_MS);
    if (reachable) {
      yield text(
        `${REPLY_BYTES} bytes from ${address}: icmp_seq=${sequence} ttl=${TTL} time=${replyTimeMs(address, sequence)} ms`,
      );
    }
  }

  const received = reachable ? ECHO_COUNT : 0;
  const loss = Math.round(((ECHO_COUNT - received) / ECHO_COUNT) * 100);
  yield text('');
  yield text(`--- ${target} ping statistics ---`);
  yield text(`${ECHO_COUNT} packets transmitted, ${received} received, ${loss}% packet loss`);
  return received > 0 ? 0 : 1;
}

/** Whether anything at `address` answers a box standing at `vantage`: the box itself,
 *  a generated host on the network's LAN, a host on a deep layer it reaches, or a
 *  fellow player's box on its LAN. */
const answers = async (
  env: CommandEnv,
  vantage: Vantage,
  address: string,
  occupantsHere: () => Promise<readonly OccupantProjection[]>,
): Promise<boolean> => {
  // The box's own address is part of what it reaches — pinging yourself is how you
  // check your own stack before blaming the network.
  if (address === vantage.address) return true;
  if (generateHomeLan(vantage.essid).hosts.some((host) => host.ip === address)) return true;
  for (const segment of vantage.reaches) {
    if (segment.fronting === null) continue;
    const layer = resolveDeepScanHosts(vantage.essid, segment.fronting, env.fs.root());
    if (layer.hosts.some((entry) => entry.host.ip === address)) return true;
  }
  return (await occupantsHere()).some((occupant) => occupant.localIp === address);
};

const execute: Command['execute'] = async (env, args) => {
  const target = args[0];
  if (target === undefined) {
    return error(USAGE);
  }

  const vantage = vantageOf(env.session, env.network);
  if (vantage === null) {
    return error(UNREACHABLE);
  }

  // Asked from the box the shell stands on, so the neighbours that answer are the hop's,
  // and asked once however many steps want it.
  let occupants: Promise<readonly OccupantProjection[]> | null = null;
  const occupantsHere = () =>
    (occupants ??= env.scan.resolveOccupants(vantage.essid, env.session.machineId));

  const address = await addressForTarget({
    essid: vantage.essid,
    target,
    resolveOccupants: occupantsHere,
  });
  const reachable = await answers(env, vantage, address, occupantsHere);

  // The exit code IS the answer here (0 only when something replied), so it comes from
  // the stream's own return value rather than being assumed up front.
  return streamedResult(echoes(env, target, address, reachable));
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
    synopsis: 'ping <host>',
    description:
      'Send ICMP echo requests to a host on the network you are on — your own at home, or the network of a box you have a shell on — and report which came back. Takes an address or a name. Answers reachability only — a host that replies may still be running nothing. Always sends 4 packets.',
    arguments: [
      {
        name: 'host',
        description: 'The address or name to reach, e.g. 192.168.1.5 or web-04',
        required: true,
      },
    ],
    examples: [
      { command: 'ping 192.168.1.5', description: 'Send four echo requests to a host' },
    ],
  },
  execute,
};
