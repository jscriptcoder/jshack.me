/**
 * The services a network beyond Ridgemont shows the internet besides its gateway.
 *
 * A gateway that forwards nothing looks like every other gateway from outside: `sshd`
 * on 22 and nothing else. A real one forwards what the people behind it wanted to reach
 * from home: ssh to a desk on a high port, ftp to the file server, a web app on 8080.
 * Each forward names a machine on the network's own LAN and a service that machine
 * really runs, so whatever a scan shows through it is there to connect to.
 *
 * Ridgemont's networks forward nothing beyond their site: they are hand-authored, and
 * their gateways stay as they were.
 */

import { declaredNetwork, RIDGEMONT } from './world.js';
import { generateHomeLan } from './generateHomeLan.js';
import { hostServices, siteForward } from './remoteHostFs.js';
import { createPrng } from './prng.js';
import { SERVICE_CATALOG } from '../services/serviceCatalog.js';
import type { NetworkCategory } from './pools/essidCatalog.js';
import type { NatForward } from '../network/iptablesRules.js';

/** The chance of each forward a network of a category draws, one entry per forward. An
 *  office always forwards something and sometimes a second thing; a café seldom
 *  bothers. */
const FORWARD_CHANCES: Readonly<Record<NetworkCategory, readonly number[]>> = {
  corporate: [1, 0.5],
  government: [1, 0.5],
  university: [1, 0.5],
  retail: [0.5],
  public: [0.5],
  residential: [0.5],
  iot: [0.5],
  hacker: [0.5],
  cafe: [0.3],
};

/** The high ports ssh is moved to, in the order an admin reaches for them: 22 is the
 *  gateway's own. */
const SSH_PUBLIC_PORTS: readonly number[] = [2222, 2022, 8022, 22222];
/** Where a web app answers when the public web port is not its to take. */
const WEB_PUBLIC_PORTS: readonly number[] = [8080, 8000, 8888, 8081];

/** The public web port. It belongs to the network's site, or to the page a player
 *  there serves; findit lists whatever answers on it. */
const PUBLIC_WEB_PORT = 80;

/** The ports the gateway answers on itself, which nothing can be forwarded over. */
const GATEWAY_PORTS: readonly number[] = [
  SERVICE_CATALOG.ssh.defaultPort,
  SERVICE_CATALOG.snmp.defaultPort,
];

type Candidate = { readonly ip: string; readonly service: string; readonly port: number };

/** The public port `candidate` answers on, or `undefined` when every port it could
 *  take is already taken. */
const publicPortOf = (candidate: Candidate, taken: ReadonlySet<number>): number | undefined => {
  const free = (ports: readonly number[]) => ports.find((port) => !taken.has(port));
  if (candidate.service === 'ssh') return free(SSH_PUBLIC_PORTS);
  if (candidate.service === 'http') return free([candidate.port, ...WEB_PUBLIC_PORTS]);
  return free([candidate.port]);
};

/** The forwards `key`'s gateway keeps besides its site's, in the order it keeps them. */
export const seededForwards = (key: string): readonly NatForward[] => {
  const network = declaredNetwork(key);
  if (network === undefined || network.town === RIDGEMONT) return [];

  const prng = createPrng(`gw-forwards-${key}`);
  const count = FORWARD_CHANCES[network.category].filter((chance) => prng.next() < chance).length;
  const site = siteForward(key);
  const candidates = generateHomeLan(key)
    .hosts.flatMap((host) =>
      hostServices(key, host).map(({ spec, port }) => ({
        ip: host.ip,
        service: spec.service,
        port,
      })),
    )
    .filter(({ ip, port }) => ip !== site?.internalIp || port !== site.internalPort);

  // Somebody opens a port at home to reach their own computer from outside, so a home
  // that forwards anything forwards ssh first when a machine there runs it.
  const shuffled = prng.shuffle(candidates);
  const ordered =
    network.category === 'residential'
      ? [
          ...shuffled.filter(({ service }) => service === 'ssh'),
          ...shuffled.filter(({ service }) => service !== 'ssh'),
        ]
      : shuffled;
  return ordered.reduce<readonly NatForward[]>((forwards, candidate) => {
    if (forwards.length === count) return forwards;
    const taken = new Set([
      ...GATEWAY_PORTS,
      PUBLIC_WEB_PORT,
      ...forwards.map(({ publicPort }) => publicPort),
    ]);
    const publicPort = publicPortOf(candidate, taken);
    return publicPort === undefined
      ? forwards
      : [...forwards, { publicPort, internalIp: candidate.ip, internalPort: candidate.port }];
  }, []);
};
