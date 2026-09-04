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
  // developer running a local one is real, so this is a rare find rather than none. The
  // key-value store gets no cell: the flat rate is already what a laptop should run one
  // at, and a cell restating the world's own number would be the first in this table
  // that changes nothing.
  workstation: { mysql: 0.03 },
  // A camera, a doorbell, a speaker. It runs an appliance, not an operating system
  // you were meant to log into — so a shell on one is a genuine find rather than
  // the ordinary way in.
  iot: { ssh: 0.1, mysql: 0, redis: 0 },
  // Publishing is the whole point of the box. One that serves nothing would make
  // the name a lie, which is the failure this table exists to prevent. The database
  // is the classic pairing and the one follow-on the web door has — read the page,
  // then find the tables behind it — on some of them, not all: a static site needs
  // nothing behind it.
  // The store is the correction to where legacy put one. Legacy placed redis on
  // database boxes only while generating web-application state to fill it — sessions,
  // cached profiles, permission sets. This is the highest cell in the table for it, and
  // it gives the web door a second follow-on distinct from the database's: read the
  // page, then read the SESSIONS behind it.
  webserver: { http: 0.95, mysql: 0.2, redis: 0.35 },
  // Files have to leave the box somehow, and ftp is the only door in today's
  // catalog that carries them. Nearly always up: it is what the box is for.
  fileserver: { ftp: 0.9 },
  // What the box is FOR, at last. The ftp rate comes DOWN with it: 0.6 was a stand-in
  // for a role with no door of its own, and that job is over — it stays above the flat
  // rate only because a dump still has to leave the box somehow.
  database: { mysql: 0.9, ftp: 0.4, redis: 0.3 },
  // Nothing to say yet — the door that would distinguish it (smtp) is not in the
  // catalog, and inventing an ftp or http rate for it would be flavour dressed up as
  // a rule.
  mailserver: {},
  // What the box is FOR, and the whole story for this door: the catalog's flat rate is
  // zero, so a name server exists exactly where the world named one. Not pinned at 1 —
  // a box called `ns-12` that answers nothing is a decommissioned one, and its zone
  // file is still on disk for whoever roots it, which is where the intelligence lives
  // anyway.
  dns: { domain: 0.9 },
  // Every gateway bears sshd — the reachability a forward, a pivot and the whole
  // chain behind an inner gateway all rest on. Pinned at 1 rather than guaranteed
  // in code, so a later world can make it vary without reshaping any caller.
  //
  // The agent is the first cell here that is not pinned, and the first door on a
  // gateway that is not a way IN: it hands over the port table and nothing else.
  // Usually up, because a device nobody can manage remotely is not what a router is,
  // but not always — a router that answers is then a find rather than a given.
  //
  // Only the gateway builders read these two rows. A machine's role comes back from
  // its hostname, and `roleOfHostname` returns none of the drawn seven as `router` or
  // `switch`, so a laptop cannot reach these cells however it is named.
  router: { ssh: 1, snmp: 0.6 },
  // A switch forwards frames and hands out no shell of its own — and until the agent
  // arrived it ran nothing at all, which made it the one role a player could scan and
  // never touch. This is its first and only door, so it sits higher than the router's:
  // the device with least else to offer is the one that most needs the thing it has.
  switch: { snmp: 0.9 },
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
