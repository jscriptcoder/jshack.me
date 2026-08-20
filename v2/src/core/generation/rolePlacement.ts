/**
 * rolePlacement — how likely a box of a given KIND is to run a given service.
 *
 * `SERVICE_CATALOG.placement` says how common a service is across the world at
 * large. This table says what a role does differently, so a name a player reads off
 * a scan becomes a lead rather than decoration: `www-04` nearly always answers on
 * :80, `cam-31` hardly ever offers a shell.
 *
 * SPARSE ON PURPOSE. A role names only the services it has something to say about;
 * everything else falls through to the flat rate, unchanged to the host. An empty
 * row is a statement, not an omission — `mailserver` and `dns` have nothing
 * role-specific to express while the catalog holds only ssh, http and ftp, and a
 * cell invented before its door ships would be a number with no claim behind it.
 *
 * Every role carries a row, empty or not, so a role added later cannot quietly
 * inherit somebody else's placement — and so the lookup has no missing-row branch.
 */

import type { SERVICE_CATALOG } from '../services/serviceCatalog';
import type { MachineRole } from './machineRole';

/** One row of the catalog — the literal spec of a service the world ships, as
 *  against `ServiceSpec`, which is the shape any row must have. */
type CatalogService = (typeof SERVICE_CATALOG)[keyof typeof SERVICE_CATALOG];

/** The name of a service the world ships (`ssh`, `http`, `ftp`) — narrow enough
 *  that a typo in the table below is a compile error rather than a cell that
 *  silently never applies. */
type ServiceName = CatalogService['service'];

const PLACEMENT_BY_ROLE: Readonly<Record<MachineRole, Partial<Record<ServiceName, number>>>> = {
  // Somebody's own machine, and the world's default sort of box: it is what the flat
  // rates were tuned against, so it overrides almost nothing. The exception is the
  // database, where the flat rate would put one on a twelfth of all laptops. A
  // developer running a local one is real, so this is a rare find rather than none.
  workstation: { mysql: 0.03 },
  // A camera, a doorbell, a speaker. It runs an appliance, not an operating system
  // you were meant to log into — so a shell on one is a genuine find rather than
  // the ordinary way in.
  iot: { ssh: 0.1, mysql: 0 },
  // Publishing is the whole point of the box. One that serves nothing would make
  // the name a lie, which is the failure this table exists to prevent. The database
  // is the classic pairing and the one follow-on the web door has — read the page,
  // then find the tables behind it — on some of them, not all: a static site needs
  // nothing behind it.
  webserver: { http: 0.95, mysql: 0.2 },
  // Files have to leave the box somehow, and ftp is the only door in today's
  // catalog that carries them. Nearly always up: it is what the box is for.
  fileserver: { ftp: 0.9 },
  // What the box is FOR, at last. The ftp rate comes DOWN with it: 0.6 was a stand-in
  // for a role with no door of its own, and that job is over — it stays above the flat
  // rate only because a dump still has to leave the box somehow.
  database: { mysql: 0.9, ftp: 0.4 },
  // Nothing to say yet — the doors that would distinguish these two (smtp, dns)
  // are not in the catalog, and inventing an ftp or http rate for them would be
  // flavour dressed up as a rule.
  mailserver: {},
  dns: {},
  // Every gateway bears sshd — the reachability a forward, a pivot and the whole
  // chain behind an inner gateway all rest on. Pinned at 1 rather than guaranteed
  // in code, so a later world can make it vary without reshaping any caller.
  router: { ssh: 1 },
  // A switch forwards frames; it hangs no layer and hands out no shell of its own.
  switch: {},
};

/**
 * The fraction of boxes of this role that run `spec` — the role's own rate where it
 * has one, the catalog's flat rate otherwise.
 *
 * `undefined` role means a box whose name no role claims, which takes the flat rate
 * for the same reason: absent a claim, the world's own rate is the answer.
 */
export const placementOf = (role: MachineRole | undefined, spec: CatalogService): number => {
  if (role === undefined) return spec.placement;
  const override = PLACEMENT_BY_ROLE[role][spec.service];
  return override === undefined ? spec.placement : override;
};
