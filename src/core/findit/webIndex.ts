/**
 * The web findit searches: every homepage on a public `:80`, as it is BEING SERVED —
 * each institution's under its domain, and anybody else's under the bare address it
 * answers at.
 *
 * The index is a VIEW, never a stored copy. It is built at the moment of the search out
 * of the same journals a `curl` of the same address would replay, so a page somebody
 * rewrote an instant ago is found as they rewrote it, and a site whose box is bricked
 * or whose web server was stopped is simply not there — findit cannot point at a page
 * nobody can fetch. Nothing has to be kept in step, because nothing is kept at all.
 *
 * Nobody submits a page. Being on the public web is enough to be found, which is fair
 * only because it is deliberate — a fresh gateway forwards nothing — and because a site
 * that would rather not be listed can say so in its `robots.txt`.
 *
 * The cost is paid in as few reads as the answer allows: every publisher's gateway and
 * web server together with the gateway of every other network the world declares, a
 * couple of hundred machines a read. The institutions are resolved in memory from that. A network whose gateway
 * answers nothing on `:80` — nearly all of them — costs no more;
 * one that does answer, and an institution whose gateway was repointed somewhere this
 * index cannot rebuild, is fetched the ordinary way, alone.
 */

import { DECLARED_NETWORKS, publicAddress } from '../generation/world.js';
import { publisherIp } from '../generation/publisher.js';
import { siteServer } from '../generation/siteServer.js';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity.js';
import { computeApGatewayId } from '../identity/router.js';
import { materializeApGatewayFs } from '../network/materializeRouterFs.js';
import { materializeMachineFs, type OwnerPatchRow } from '../network/materializeMachineFs.js';
import { machineServing, type ServedMachine } from '../network/machineServing.js';
import { servesWebOn } from '../network/webServing.js';
import { canBoot } from '../boot/bootFiles.js';
import { createFsView } from '../filesystem/fsView.js';
import { HTTP_DEFAULT_PORT, resolveWebPath } from '../network/http.js';
import { readPage } from './readPage.js';
import { robotsAllowFindit } from './robots.js';
import type { IndexedPage } from './search.js';
import type { Directory } from '../filesystem/types.js';
import type { LanHost } from '../generation/generateHomeLan.js';

/** A journal row as the batched read returns it: which machine it belongs to, beside
 *  everything a single-machine read already gives. */
export type MachinePatchRow = OwnerPatchRow & { readonly machine_id: string };

/** What a visitor to a site is served at its front door, and what it tells crawlers.
 *  A site with no `robots.txt` has told them nothing. */
export type ServedSite = { readonly homepage: string; readonly robotsTxt: string | null };

export type WebIndexDeps = {
  /** Every named machine's journal in one read, in the order a per-machine read
   *  returns them. The index asks for its machines a batch at a time. */
  readonly findPatchesForMachines: (
    machineIds: readonly string[],
  ) => Promise<{ readonly data: readonly MachinePatchRow[] | null; readonly error: unknown }>;
  /** The site at a public address, fetched the ordinary way — for a page this index
   *  cannot rebuild from the generated world. Null when nothing answers. */
  readonly siteAt: (publicIp: string) => Promise<ServedSite | null>;
};

/** How many machines one journal read names. A read names them in its request's address,
 *  and the database's gateway refuses an address past about 8 KB: one naming 281 machines
 *  in 6.7 KB was answered and one naming 529 in 12.6 KB was not. 200 keeps a read near
 *  5 KB, so the index costs a few round trips rather than one per site. */
const MACHINES_PER_READ = 200;

/** An institution that publishes, with the two machines a visit to it passes through. */
type Publisher = {
  readonly essid: string;
  readonly domain: string;
  readonly gatewayId: string;
  /** The machine the institution serves its site from — kept whole, because the box it
   *  rebuilds into is seeded from its name as well as its address. */
  readonly server: LanHost;
  readonly serverId: string;
};

const PUBLISHERS: readonly Publisher[] = DECLARED_NETWORKS.flatMap((network) => {
  const server = network.site === undefined ? undefined : siteServer(network.key);
  if (network.site === undefined || server === undefined) return [];
  return [
    {
      essid: network.key,
      domain: network.site.domain,
      gatewayId: computeApGatewayId(network.key),
      server,
      serverId: resolveLanHostIdentity(server, network.key).machineId,
    },
  ];
});

/** Every machine the index reads for the institutions: each publisher's gateway, and
 *  the box behind it. */
export const publisherMachineIds = (): readonly string[] =>
  PUBLISHERS.flatMap((publisher) => [publisher.gatewayId, publisher.serverId]);

const rowsByMachine = (
  rows: readonly MachinePatchRow[],
): ReadonlyMap<string, readonly OwnerPatchRow[]> => {
  const grouped = new Map<string, MachinePatchRow[]>();
  for (const row of rows) {
    const existing = grouped.get(row.machine_id);
    if (existing === undefined) grouped.set(row.machine_id, [row]);
    else existing.push(row);
  }
  return grouped;
};

/** A file a box publishes at a URL path, or null when it publishes none there. Read as
 *  the SERVER: a published page is written by root and readable by root alone, and the
 *  confinement is the document root rather than the file's permissions. */
const publishedOn = (fs: Directory, urlPath: string): string | null => {
  const filePath = resolveWebPath(urlPath);
  if (filePath === null) return null;
  const read = createFsView(fs, { userType: 'root' }).read(filePath);
  return read.ok ? read.content : null;
};

/** The site a box is serving, or null when its document root has no front page. */
export const siteOn = (fs: Directory): ServedSite | null => {
  const homepage = publishedOn(fs, '/');
  return homepage === null ? null : { homepage, robotsTxt: publishedOn(fs, '/robots.txt') };
};

/** What a gateway does with a visitor to its public `:80`, or null when it does nothing
 *  with them: it will not come up — which takes the whole address dark, whatever is
 *  still running behind it — or nothing answers the web there at all. */
const webBehind = (gatewayFs: Directory): ServedMachine | null => {
  if (!canBoot(gatewayFs).ok) return null;
  const served = machineServing({ routerFs: gatewayFs, port: HTTP_DEFAULT_PORT });
  return served.kind === 'none' ? null : served;
};

/** What a visitor to one publisher's public `:80` would be served, or null when nothing
 *  would answer them. */
const publisherSiteServed = async (
  deps: WebIndexDeps,
  publisher: Publisher,
  journals: ReadonlyMap<string, readonly OwnerPatchRow[]>,
): Promise<ServedSite | null> => {
  const served = webBehind(
    materializeApGatewayFs({ essid: publisher.essid }, journals.get(publisher.gatewayId) ?? null),
  );
  if (served === null) return null;

  // Anything OTHER than the generated site server is a box this index never read — the
  // gateway itself, now serving its own page, or a forward somebody repointed at their
  // own machine. That one site is fetched the ordinary way rather than guessed at, so
  // whatever really answers is what gets listed.
  if (served.kind !== 'forward' || served.internalIp !== publisher.server.ip) {
    const address = publisherIp(publisher.essid);
    return address === undefined ? null : deps.siteAt(address);
  }

  const { baseFs } = resolveLanHostIdentity(publisher.server, publisher.essid);
  const serverFs = materializeMachineFs(baseFs, journals.get(publisher.serverId) ?? null);
  if (!canBoot(serverFs).ok) return null;
  if (!servesWebOn(serverFs, served.internalPort)) return null;
  return siteOn(serverFs);
};

/** A network that could serve a player's page: every one the world declares but an
 *  institution's, which is listed under its domain already. findit is no declared
 *  network, so it is never among them. */
const PLAYER_NETWORKS: readonly { readonly essid: string; readonly address: string }[] =
  DECLARED_NETWORKS.flatMap((network) => {
    const address = publicAddress(network.key);
    return network.site === undefined && address !== undefined
      ? [{ essid: network.key, address }]
      : [];
  });

/** What a visitor to a network's public `:80` would be served. Its gateway is read
 *  first, from the batch, so a network that answers nothing there — nearly every one —
 *  is ruled out without another read; only one that answers is fetched. */
const playerSiteServed = async (
  deps: WebIndexDeps,
  network: (typeof PLAYER_NETWORKS)[number],
  journals: ReadonlyMap<string, readonly OwnerPatchRow[]>,
): Promise<ServedSite | null> => {
  const gatewayFs = materializeApGatewayFs(
    { essid: network.essid },
    journals.get(computeApGatewayId(network.essid)) ?? null,
  );
  return webBehind(gatewayFs) === null ? null : deps.siteAt(network.address);
};

/** A served site as findit lists it — or not at all, when nothing is served there or
 *  the site asked not to be listed. */
const listing = (site: ServedSite | null, address: string): readonly IndexedPage[] => {
  if (site === null || !robotsAllowFindit(site.robotsTxt)) return [];
  return [{ address, ...readPage(site.homepage, address) }];
};

/**
 * Every page findit can answer with, read from the world as it stands.
 *
 * A read that fails yields NO index rather than a partial one: half a web would rank a
 * site first because the sites above it were unreadable, which is a worse answer than
 * admitting the search found nothing.
 */
export const indexedWeb = async (deps: WebIndexDeps): Promise<readonly IndexedPage[]> => {
  const machineIds = [
    ...publisherMachineIds(),
    ...PLAYER_NETWORKS.map((network) => computeApGatewayId(network.essid)),
  ];
  // Each machine is named in one read alone, so its journal arrives whole and in order.
  const reads = await Promise.all(
    Array.from({ length: Math.ceil(machineIds.length / MACHINES_PER_READ) }, (_, index) =>
      deps.findPatchesForMachines(
        machineIds.slice(index * MACHINES_PER_READ, (index + 1) * MACHINES_PER_READ),
      ),
    ),
  );
  if (reads.some((read) => read.error)) return [];
  const journals = rowsByMachine(reads.flatMap((read) => read.data ?? []));

  const pages = await Promise.all([
    ...PUBLISHERS.map(async (publisher) =>
      listing(await publisherSiteServed(deps, publisher, journals), publisher.domain),
    ),
    ...PLAYER_NETWORKS.map(async (network) =>
      listing(await playerSiteServed(deps, network, journals), network.address),
    ),
  ]);
  return pages.flat();
};
