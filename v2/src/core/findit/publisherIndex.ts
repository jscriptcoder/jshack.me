/**
 * The web findit searches: every institution's homepage, as it is BEING SERVED.
 *
 * The index is a VIEW, never a stored copy. It is built at the moment of the search out
 * of the same journals a `curl` of the same address would replay, so a page somebody
 * rewrote an instant ago is found as they rewrote it, and a site whose box is bricked
 * or whose web server was stopped is simply not there — findit cannot point at a page
 * nobody can fetch. Nothing has to be kept in step, because nothing is kept at all.
 *
 * The cost of that is paid in ONE read: every publisher's gateway and web server is
 * asked for at once, and the ~30 sites are then resolved in memory. The one case that
 * cannot be resolved from the generated world — a gateway somebody has repointed at a
 * box of their own — falls back to the ordinary public fetch for that site alone.
 */

import { ESSID_CATALOG } from '../generation/pools/essidCatalog';
import { publisherIp } from '../generation/publisher';
import { siteServer } from '../generation/siteServer';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { computeApGatewayId } from '../identity/router';
import { materializeApGatewayFs } from '../network/materializeRouterFs';
import { materializeMachineFs, type OwnerPatchRow } from '../network/materializeMachineFs';
import { machineServing } from '../network/machineServing';
import { servesWebOn } from '../network/webServing';
import { canBoot } from '../boot/bootFiles';
import { createFsView } from '../filesystem/fsView';
import { HTTP_DEFAULT_PORT, resolveWebPath } from '../network/http';
import { readPage } from './readPage';
import type { IndexedPage } from './search';
import type { Directory } from '../filesystem/types';
import type { LanHost } from '../generation/generateHomeLan';

/** A journal row as the batched read returns it: which machine it belongs to, beside
 *  everything a single-machine read already gives. */
export type MachinePatchRow = OwnerPatchRow & { readonly machine_id: string };

export type PublisherIndexDeps = {
  /** Every named machine's journal in one read, in the order a per-machine read
   *  returns them. */
  readonly findPatchesForMachines: (
    machineIds: readonly string[],
  ) => Promise<{ readonly data: readonly MachinePatchRow[] | null; readonly error: unknown }>;
  /** The homepage at a public address, fetched the ordinary way — for the site whose
   *  gateway no longer points where the world generated it. Null when nothing answers. */
  readonly resolveElsewhere: (publicIp: string) => Promise<string | null>;
};

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

const PUBLISHERS: readonly Publisher[] = ESSID_CATALOG.flatMap((entry) => {
  const server = entry.site === undefined ? undefined : siteServer(entry.essid);
  if (entry.site === undefined || server === undefined) return [];
  return [
    {
      essid: entry.essid,
      domain: entry.site.domain,
      gatewayId: computeApGatewayId(entry.essid),
      server,
      serverId: resolveLanHostIdentity(server, entry.essid).machineId,
    },
  ];
});

/** Every machine the index reads: each publisher's gateway, and the box behind it. */
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

/** The homepage a box is serving, or null when its document root holds none. Read as
 *  the SERVER: a published page is written by root and readable by root alone, and the
 *  confinement is the document root rather than the file's permissions. */
const homepageOn = (fs: Directory): string | null => {
  const filePath = resolveWebPath('/');
  if (filePath === null) return null;
  const read = createFsView(fs, { userType: 'root' }).read(filePath);
  return read.ok ? read.content : null;
};

/** What a visitor to one publisher's public `:80` would be served, or null when nothing
 *  would answer them. */
const servedHomepage = async (
  deps: PublisherIndexDeps,
  publisher: Publisher,
  journals: ReadonlyMap<string, readonly OwnerPatchRow[]>,
): Promise<string | null> => {
  const gatewayFs = materializeApGatewayFs(
    { essid: publisher.essid },
    journals.get(publisher.gatewayId) ?? null,
  );
  // A bricked gateway takes the whole address dark, whatever is still running behind it.
  if (!canBoot(gatewayFs).ok) return null;

  const served = machineServing({ routerFs: gatewayFs, port: HTTP_DEFAULT_PORT });
  // Nothing answers the web here at all: the forward was deleted, and the gateway is not
  // serving in its place. There is no page to list.
  if (served.kind === 'none') return null;

  // Anything OTHER than the generated site server is a box this index never read — the
  // gateway itself, now serving its own page, or a forward somebody repointed at their
  // own machine. That one site is fetched the ordinary way rather than guessed at, so
  // whatever really answers is what gets listed.
  if (served.kind !== 'forward' || served.internalIp !== publisher.server.ip) {
    const address = publisherIp(publisher.essid);
    return address === undefined ? null : deps.resolveElsewhere(address);
  }

  const { baseFs } = resolveLanHostIdentity(publisher.server, publisher.essid);
  const serverFs = materializeMachineFs(baseFs, journals.get(publisher.serverId) ?? null);
  if (!canBoot(serverFs).ok) return null;
  if (!servesWebOn(serverFs, served.internalPort)) return null;
  return homepageOn(serverFs);
};

/**
 * Every page findit can answer with, read from the world as it stands.
 *
 * A journal that cannot be read yields NO index rather than a partial one: half a web
 * would rank a site first because the sites above it were unreadable, which is a worse
 * answer than admitting the search found nothing.
 */
export const indexedWeb = async (deps: PublisherIndexDeps): Promise<readonly IndexedPage[]> => {
  const patches = await deps.findPatchesForMachines(publisherMachineIds());
  if (patches.error) return [];
  const journals = rowsByMachine(patches.data ?? []);

  const pages = await Promise.all(
    PUBLISHERS.map(async (publisher) => {
      const homepage = await servedHomepage(deps, publisher, journals);
      if (homepage === null) return [];
      const { title, description, text } = readPage(homepage, publisher.domain);
      return [{ address: publisher.domain, title, description, text }];
    }),
  );
  return pages.flat();
};
