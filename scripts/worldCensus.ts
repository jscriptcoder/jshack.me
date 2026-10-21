/**
 * worldCensus — count the whole declared world: its networks, every machine the generators
 * place on them, what those machines run, and the command surface.
 *
 * Read-only and offline: it builds no filesystem and touches no server, so it runs in a couple
 * of seconds. Its output is what `docs/world-in-numbers.md` records; a change that moves the
 * world reruns it and refreshes that doc.
 *
 *   npx tsx scripts/worldCensus.ts
 */

import { DECLARED_NETWORKS, TOWNS, isLandmark } from '../src/core/generation/world.js';
import { generateHomeLan, type LanHost } from '../src/core/generation/generateHomeLan.js';
import { chainLinks } from '../src/core/generation/lanTopology.js';
import { generateDeepLayer } from '../src/core/generation/generateDeepLayer.js';
import { hostServices } from '../src/core/generation/remoteHostFs.js';
import { roleOfHostname } from '../src/core/generation/pools/hostnames.js';
import { seededForwards } from '../src/core/generation/seededForwards.js';
import { FIXED_BOXES, FIXED_SITES } from '../src/core/generation/fixedSites.js';
import { commandRegistry } from '../src/core/commands/registry.js';

type Tally = Map<string, number>;

const add = (tally: Tally, key: string): void => {
  tally.set(key, (tally.get(key) ?? 0) + 1);
};

const printTally = (title: string, tally: Tally): void => {
  console.log(`\n## ${title}`);
  [...tally.entries()]
    .sort((left, right) => right[1] - left[1])
    .forEach(([key, count]) => console.log(`${key}\t${count}`));
};

const networksByTown: Tally = new Map();
const machinesByTown: Tally = new Map();
const byCategory: Tally = new Map();
const byProfile: Tally = new Map();
const byKind: Tally = new Map();
const hostKinds: Tally = new Map();
const roles: Tally = new Map();
const services: Tally = new Map();
const programs: Tally = new Map();
let sites = 0;
let unlisted = 0;
let landmarks = 0;
let branches = 0;
let forwards = 0;
let gateways = 0;
let machines = 0;
let machinesRunningServices = 0;
let serviceCount = 0;

const countMachine = (key: string, host: LanHost, town: string): void => {
  machines += 1;
  add(machinesByTown, town);
  add(roles, roleOfHostname(host.hostname) ?? 'unknown');
  const running = hostServices(key, host);
  if (running.length > 0) machinesRunningServices += 1;
  serviceCount += running.length;
  running.forEach((service) => {
    add(services, service.spec.service);
    add(programs, service.program);
  });
};

for (const network of DECLARED_NETWORKS) {
  const town = network.town ?? '(no town: corporation head office)';
  add(networksByTown, town);
  add(byCategory, network.category);
  add(byProfile, network.profile ?? (isLandmark(network.key) ? 'deep (landmark)' : 'none'));
  if (network.subtype !== undefined) add(byKind, network.subtype);
  if (network.site !== undefined) sites += 1;
  if (network.unlisted) unlisted += 1;
  if (isLandmark(network.key)) landmarks += 1;
  if (network.parent !== undefined) branches += 1;
  forwards += seededForwards(network.key).length;

  generateHomeLan(network.key).hosts.forEach((host) => {
    add(hostKinds, `LAN ${host.kind}`);
    if (host.kind === 'machine') countMachine(network.key, host, town);
    else gateways += 1;
  });
  // Each chain link fronts one layer holding one machine; a link hanging behind another
  // gateway is itself a deep gateway (the Layer-1 links are the LAN's own router and switch).
  chainLinks(network.key).forEach((link) => {
    if (link.parentMachineId !== null) {
      gateways += 1;
      add(hostKinds, `deep ${link.host.kind}`);
    }
    const layer = generateDeepLayer(network.key, {
      machineId: link.machineId,
      kind: link.host.kind,
    });
    add(hostKinds, 'deep machine');
    countMachine(network.key, layer.host, town);
  });
}

console.log(`declared networks\t${DECLARED_NETWORKS.length}`);
console.log(`towns\t${TOWNS.length}`);
console.log(`landmarks\t${landmarks}`);
console.log(`corporate branches\t${branches}`);
console.log(`network websites\t${sites} (unlisted ${unlisted})`);
console.log(`seeded forwards beyond a site\t${forwards}`);
console.log(`fixed sites\t${FIXED_SITES.map((site) => site.domain).join(', ')}`);
console.log(`fixed boxes\t${FIXED_BOXES.length}`);
console.log(`NPC machines\t${machines}`);
console.log(`gateways (routers + switches, every layer)\t${gateways}`);
console.log(`generated boxes\t${machines + gateways}`);
console.log(`all boxes\t${machines + gateways + FIXED_BOXES.length}`);
console.log(`machines running a service\t${machinesRunningServices} (${serviceCount} services)`);
console.log(`commands\t${commandRegistry.size}`);
printTally('networks by town', networksByTown);
printTally('NPC machines by town', machinesByTown);
printTally('networks by category', byCategory);
printTally('networks by profile', byProfile);
printTally('networks by kind', byKind);
printTally('hosts by kind', hostKinds);
printTally('machine roles', roles);
printTally('services', services);
printTally('programs', programs);
