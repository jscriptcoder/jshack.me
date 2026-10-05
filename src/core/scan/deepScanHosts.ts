/**
 * resolveDeepScanHosts — the single map from the gateway fronting a deep layer to the
 * hosts on it: each host's storage machine_id + seeded base FS, and its open ports
 * AFTER the fronting gateway's ACL filter. The CLIENT scan (`nmap`'s render) and the
 * SERVER scan trace (`handleNmapScan`) both resolve a layer through HERE, so the ports
 * a scan displays and the ports its kern.log trace records can never drift.
 *
 * A layer carries the terminal NPC always, plus the CHILD GATEWAY when a router
 * fronting it hangs one (a switch forwards nothing, so it fronts no child). An NPC
 * reads its forced-sshd tree (`buildDeepHostFs`); a child gateway — router OR switch —
 * reads its own gateway base FS via `resolveDeepGatewayIdentity` (so a switch child
 * is an `acl.conf` box, never aliased onto the generic NPC tree). When the fronting
 * gateway is a SWITCH, its `/etc/switch/acl.conf` filters the whole layer: a denied
 * port is dropped from every host's reported ports.
 *
 * Pure + framework-agnostic (core/): the fronting gateway's filesystem is supplied by
 * the caller — the client's live tree, or the server's materialized journal — so this
 * layer never reads the world itself.
 */

import { generateDeepLayer, hostsOnLayer } from '../generation/generateDeepLayer.js';
import { buildDeepHostFs } from '../generation/deepHostFs.js';
import { resolveDeepGatewayIdentity } from '../generation/lanHostIdentity.js';
import type { ChainLink } from '../generation/lanTopology.js';
import { hostMachineId } from '../generation/remoteHostId.js';
import { parseAclDenies, readAclConf } from '../network/switchAcl.js';
import { readOpenPorts, type OpenPort } from '../services/pidfile.js';
import type { Directory } from '../filesystem/types.js';
import type { LanHost } from '../generation/generateHomeLan.js';

/** One host on a pivot-scanned deep layer: the host descriptor, the machine_id its
 *  trace + reach land on, its seeded tree, and its open ports after the vantage ACL
 *  filter. */
export type DeepScanHost = {
  readonly host: LanHost;
  readonly machineId: string;
  readonly baseFs: Directory;
  readonly ports: readonly OpenPort[];
};

/** A deep layer: its `/24` prefix and its hosts (terminal NPC + optional child
 *  gateway). */
export type DeepScanResolution = {
  readonly subnet: string;
  readonly hosts: readonly DeepScanHost[];
};

/** The ports the fronting gateway's ACL blocks on its layer: a switch filters via its
 *  live `/etc/switch/acl.conf`; a router forwards rather than filters, so it denies
 *  nothing. One discriminant, shared by client and server. */
export const deniedPortsFor = (fronting: ChainLink, frontingFs: Directory): ReadonlySet<number> =>
  fronting.host.kind === 'switch'
    ? new Set(parseAclDenies(readAclConf(frontingFs)))
    : new Set<number>();

export const resolveDeepScanHosts = (
  essid: string,
  fronting: ChainLink,
  frontingFs: Directory,
  gameDay?: number | undefined,
): DeepScanResolution => {
  const deep = generateDeepLayer(
    essid,
    { machineId: fronting.machineId, kind: fronting.host.kind },
    { hangsChild: fronting.hangsChild },
  );
  const deniedPorts = deniedPortsFor(fronting, frontingFs);
  const layerHosts = hostsOnLayer(deep);
  const hosts = layerHosts.map((host) => {
    // The terminal NPC is a coordinate-keyed box with sshd forced up; a child gateway
    // (router OR switch) takes its octet-keyed deep-gateway identity, so a switch child
    // resolves to its acl.conf box rather than aliasing the generic NPC tree.
    const identity =
      host.kind === 'machine'
        ? { machineId: hostMachineId(host, essid), baseFs: buildDeepHostFs(essid, host) }
        : resolveDeepGatewayIdentity(essid, fronting.machineId, host.ip, host.kind);
    const ports = readOpenPorts(identity.baseFs, { gameDay }).filter(
      (openPort) => !deniedPorts.has(openPort.port),
    );
    return { host, machineId: identity.machineId, baseFs: identity.baseFs, ports };
  });
  return { subnet: deep.subnet, hosts };
};
