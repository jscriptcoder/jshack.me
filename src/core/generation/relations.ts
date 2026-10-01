/**
 * Who in a town beyond Ridgemont knows the way to whom.
 *
 * A home publishes nothing, so nothing on the internet leads to it. The businesses of
 * its town know where it is: an IT contractor keeps a shortcut to every client it looks
 * after, and a shop that backs its files up offsite copies them to somebody's box every
 * night. Each such lead is a relation, and a relation is the only way a network that
 * publishes nothing can be found.
 *
 * A relation is drawn on the side it leads TO, on a stream of the target's own, so every
 * network knows its own leads without walking the town, and adding a network to a town
 * moves nobody else's. The side it comes FROM finds it by asking every network of its
 * town, and so reads the very same value: the shortcut on the contractor's desk and the
 * door it opens can never disagree.
 *
 * A corporation's branch in a town is its company's, not its town's: its IT is the head
 * office's, so no business of the town leads to it and it leads to none. The head office's
 * gateway keeps the one lead there.
 */

import {
  declaredNetwork,
  DECLARED_NETWORKS,
  publicAddress,
  RIDGEMONT,
  type DeclaredNetwork,
} from './world.js';
import { generateHomeLan, type LanHost } from './generateHomeLan.js';
import { hostServices, npcUsername } from './remoteHostFs.js';
import { seededForwards } from './seededForwards.js';
import { isDeskMachine } from './npcHome.js';
import { roleOfHostname } from './pools/hostnames.js';
import { createPrng } from './prng.js';
import { keepsSnapshots } from './share.js';

/** A lead kept on one network's box to another network. */
type Lead = {
  /** The key of the network the lead is kept on. */
  readonly source: string;
  /** The box the lead is kept on. */
  readonly sourceHost: LanHost;
  /** The key of the network the lead goes to. */
  readonly target: string;
  /** The address the target answers at on the internet. */
  readonly address: string;
};

/** A lead that logs in at the target: a contractor's shortcut on a desk, a file
 *  server's nightly offsite copy, or a head office's shortcut to its branch. */
export type Login = Lead & {
  readonly kind: 'contractor' | 'backup' | 'branch';
  /** The port that opens onto the box the lead reaches there. */
  readonly port: number;
  /** The box that port reaches: one behind the target's gateway, or the gateway. */
  readonly targetHost: LanHost;
  /** The account the lead logs in as on that box. */
  readonly user: string;
};

/** An unlisted business's invoice, kept on the share of a customer that is listed. */
export type Supply = Lead & { readonly kind: 'supplier' };

export type Relation = Login | Supply;

/** How many leads a home and a publisher are the target of. Every home is somebody's
 *  client, or nothing would lead to it; a business may be nobody's. */
const HOME_RELATIONS = { min: 1, max: 3 };
const PUBLISHER_RELATIONS = { min: 0, max: 2 };

/** The standard ssh port, on which a gateway answers itself. */
const GATEWAY_SSH_PORT = 22;
/** The one account a gateway's sshd knows. */
const GATEWAY_USER = 'root';

type Endpoint = Pick<Login, 'port' | 'targetHost' | 'user'>;

/** The door a lead to `key` opens: the box behind its gateway's ssh forward when it
 *  keeps one, otherwise the gateway's own sshd. */
const endpointOf = (key: string): { readonly endpoint: Endpoint; readonly forwarded: boolean } => {
  const hosts = generateHomeLan(key).hosts;
  const forwarded = seededForwards(key).flatMap((forward) => {
    const host = hosts.find((candidate) => candidate.ip === forward.internalIp);
    const runsSsh =
      host !== undefined &&
      hostServices(key, host).some(
        ({ spec, port }) => spec.service === 'ssh' && port === forward.internalPort,
      );
    return runsSsh ? [{ port: forward.publicPort, targetHost: host }] : [];
  })[0];
  if (forwarded !== undefined) {
    return {
      endpoint: { ...forwarded, user: npcUsername(key, forwarded.targetHost) },
      forwarded: true,
    };
  }
  const [gateway] = hosts;
  if (gateway === undefined) throw new Error(`${key} has no gateway`);
  return {
    endpoint: { port: GATEWAY_SSH_PORT, targetHost: gateway, user: GATEWAY_USER },
    forwarded: false,
  };
};

type Candidate = {
  readonly kind: Login['kind'];
  readonly source: string;
  readonly hosts: readonly LanHost[];
};

/** A publisher of a town, with the boxes a lead to another network could be kept on:
 *  the desks of an office, where a contractor keeps shortcuts, and the file servers
 *  whose share could be copied offsite or hold a supplier's invoice. */
type Keeper = {
  readonly source: string;
  /** Set when no search lists it, so nobody finds a lead it keeps. */
  readonly unlisted: boolean;
  readonly desks: readonly LanHost[];
  readonly fileServers: readonly LanHost[];
};

/** Every publisher of `town`, in the order the world declares them, read once for all
 *  the networks a caller draws for. */
const keepersIn = (town: string): readonly Keeper[] =>
  DECLARED_NETWORKS.filter((network) => network.town === town && network.site !== undefined).map(
    (network) => {
      // A router's name is never a desk's or a file server's, so the whole LAN can be read.
      const { hosts } = generateHomeLan(network.key);
      return {
        source: network.key,
        unlisted: network.unlisted === true,
        desks: network.category === 'corporate' ? hosts.filter(isDeskMachine) : [],
        fileServers: hosts.filter((host) => roleOfHostname(host.hostname) === 'fileserver'),
      };
    },
  );

/** Whether `target`'s site is on its town's directory, where an unlisted institution is
 *  found. */
const isOnDirectory = (target: DeclaredNetwork): boolean =>
  DECLARED_NETWORKS.some(
    (network) =>
      network.town === target.town &&
      (network.directory ?? []).some((site) => site.domain === target.site?.domain),
  );

/** The supplier lead to an unlisted business, which no search lists and no directory
 *  names: its invoice, on the working share of a customer a search does list. Drawn on
 *  a stream of its own, so the target's other leads keep theirs. */
const supplierTo = (
  target: DeclaredNetwork,
  address: string,
  keepers: readonly Keeper[],
): readonly Supply[] => {
  if (target.unlisted !== true || isOnDirectory(target)) return [];
  const customers = keepers.flatMap((keeper) => {
    const shares = keeper.fileServers.filter((host) => !keepsSnapshots(host));
    return keeper.source === target.key || keeper.unlisted || shares.length === 0
      ? []
      : [{ source: keeper.source, shares }];
  });
  if (customers.length === 0) return [];
  const prng = createPrng(`relation-supplier-${target.key}`);
  const customer = prng.pick(customers);
  return [
    {
      kind: 'supplier',
      source: customer.source,
      sourceHost: prng.pick(customer.shares),
      target: target.key,
      address,
    },
  ];
};

/** Every lead that goes to `target`, drawn from the leads `keepers` could keep. */
const drawnTo = (target: DeclaredNetwork, keepers: readonly Keeper[]): readonly Relation[] => {
  const address = publicAddress(target.key);
  if (address === undefined) return [];

  // A business keeps its offsite copy at somebody's home, never at another business; and
  // a home that lets ssh in from outside does so for the copy it keeps.
  const isHome = target.site === undefined;
  const { endpoint, forwarded } = endpointOf(target.key);
  const takesBackups = isHome && forwarded;
  const candidates = keepers
    .filter((keeper) => keeper.source !== target.key)
    .flatMap(({ source, desks, fileServers }): readonly Candidate[] => [
      ...(desks.length > 0 ? [{ kind: 'contractor' as const, source, hosts: desks }] : []),
      ...(takesBackups && fileServers.length > 0
        ? [{ kind: 'backup' as const, source, hosts: fileServers }]
        : []),
    ]);

  const prng = createPrng(`relations-${target.key}`);
  const range = isHome ? HOME_RELATIONS : PUBLISHER_RELATIONS;
  const count = prng.nextInt(range.min, range.max);
  const backups = candidates.filter((candidate) => candidate.kind === 'backup');
  const first = takesBackups && backups.length > 0 ? [prng.pick(backups)] : [];
  const rest = prng.pickN(
    candidates.filter((candidate) => !first.includes(candidate)),
    count - first.length,
  );
  const logins = [...first, ...rest].map(
    ({ kind, source, hosts }): Login => ({
      kind,
      source,
      sourceHost: prng.pick(hosts),
      target: target.key,
      address,
      ...endpoint,
    }),
  );
  return [...logins, ...supplierTo(target, address, keepers)];
};

/** The lead to `branch` from the corporation it is an office of, kept on that
 *  corporation's gateway. */
const branchLead = (branch: DeclaredNetwork, parent: string): Login => {
  const address = publicAddress(branch.key);
  const [gateway] = generateHomeLan(parent).hosts;
  if (address === undefined || gateway === undefined) {
    throw new Error(`${parent} cannot lead to its branch ${branch.key}`);
  }
  return {
    kind: 'branch',
    source: parent,
    sourceHost: gateway,
    target: branch.key,
    address,
    ...endpointOf(branch.key).endpoint,
  };
};

/** The leads `key`'s gateway keeps to the branches of its corporation: one to each, and
 *  none for a network that has no branch. Read without walking any town. */
export const branchLeadsFrom = (key: string): readonly Login[] =>
  DECLARED_NETWORKS.filter((network) => network.parent === key).map((branch) =>
    branchLead(branch, key),
  );

/** The town whose networks lead to and from the one under `key`. Leads are drawn among
 *  the networks of a town beyond Ridgemont, so a Ridgemont network has none, and neither
 *  has one that stands in no town. */
const leadingTown = (key: string): string | undefined => {
  const town = declaredNetwork(key)?.town;
  return town === RIDGEMONT ? undefined : town;
};

/** Every lead that goes to `key`, in the order it was drawn. */
export const relationsTo = (key: string): readonly Relation[] => {
  const target = declaredNetwork(key);
  if (target?.parent !== undefined) return [branchLead(target, target.parent)];
  const town = leadingTown(key);
  if (target === undefined || town === undefined) return [];
  return drawnTo(target, keepersIn(town));
};

/** Every lead `key` keeps to a network of its own town, read from the networks it leads
 *  to. A network with no desk or file server to keep one on keeps none, and is not asked. */
const townLeadsFrom = (key: string): readonly Relation[] => {
  const town = leadingTown(key);
  if (town === undefined) return [];
  const keepers = keepersIn(town);
  const own = keepers.find((keeper) => keeper.source === key);
  if (own === undefined || (own.desks.length === 0 && own.fileServers.length === 0)) return [];
  // A branch is its company's, and only its company leads to it.
  return DECLARED_NETWORKS.filter(
    (network) => network.town === town && network.parent === undefined,
  ).flatMap((network) => drawnTo(network, keepers).filter((relation) => relation.source === key));
};

/** Every lead kept on `key`'s boxes: to its corporation's branches, and to the networks
 *  of its town. */
export const relationsFrom = (key: string): readonly Relation[] => [
  ...branchLeadsFrom(key),
  ...townLeadsFrom(key),
];
