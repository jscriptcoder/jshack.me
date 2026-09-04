/**
 * resolveDeepScanHosts — the single map from a pivot vantage to the deep `/24`
 * behind it: which hosts sit on the layer, each host's storage machine_id + seeded
 * base FS, and its open ports AFTER the vantage's ACL filter. The CLIENT pivot scan
 * (`nmap`'s render) and the SERVER scan trace (`handleNmapScanDeep`) both resolve
 * the layer through HERE, so the ports a scan displays and the ports its kern.log
 * trace records can never drift.
 *
 * A layer carries the terminal NPC always, plus the CHILD GATEWAY when a router
 * vantage hangs one (a switch forwards nothing, so it fronts no child). An NPC reads
 * its forced-sshd tree (`buildDeepHostFs`); a child gateway — router OR switch —
 * reads its own gateway base FS via `resolveDeepGatewayIdentity` (so a switch child
 * is an `acl.conf` box, never aliased onto the generic NPC tree). When the vantage
 * itself is a SWITCH, its `/etc/switch/acl.conf` filters the whole downstream view:
 * a denied port is dropped from every host's reported ports. The fronting gateway's
 * downstream interface is `${subnet}.1` — the source IP a deep trace records.
 *
 * Pure + framework-agnostic (core/): the vantage filesystem is supplied by the
 * caller — the client's live journal-replayed tree, or the server's materialized
 * journal — so this layer never reads the world itself.
 */

import { generateDeepLayer, hostsOnLayer } from '../generation/generateDeepLayer';
import { buildDeepHostFs } from '../generation/deepHostFs';
import { resolveDeepGatewayIdentity, type PivotVantage } from '../generation/lanHostIdentity';
import { hostMachineId } from '../generation/remoteHostId';
import { parseAclDenies, readAclConf } from '../network/switchAcl';
import { readOpenPorts, type OpenPort } from '../services/pidfile';
import type { Directory } from '../filesystem/types';
import type { LanHost } from '../generation/generateHomeLan';

/** One host on a pivot-scanned deep layer: the host descriptor, the machine_id its
 *  trace + reach land on, and its open ports after the vantage ACL filter. */
export type DeepScanHost = {
  readonly host: LanHost;
  readonly machineId: string;
  readonly ports: readonly OpenPort[];
};

/** The deep `/24` behind a pivot vantage: its prefix, the `.1` source IP a trace
 *  records, and the touched hosts (terminal NPC + optional child gateway). */
export type DeepScanResolution = {
  readonly subnet: string;
  readonly sourceIp: string;
  readonly hosts: readonly DeepScanHost[];
};

/** The ports a vantage's ACL blocks on its downstream segment: a switch filters via
 *  its live `/etc/switch/acl.conf`; a router forwards rather than filters, so it
 *  denies nothing. One discriminant, shared by client and server. */
const deniedPortsFor = (vantage: PivotVantage, vantageFs: Directory): ReadonlySet<number> =>
  vantage.kind === 'switch'
    ? new Set(parseAclDenies(readAclConf(vantageFs)))
    : new Set<number>();

export const resolveDeepScanHosts = (
  essid: string,
  vantage: PivotVantage,
  vantageFs: Directory,
): DeepScanResolution => {
  const deep = generateDeepLayer(
    essid,
    { machineId: vantage.machineId, kind: vantage.kind },
    { hangsChild: vantage.hangsChild },
  );
  const deniedPorts = deniedPortsFor(vantage, vantageFs);
  const layerHosts = hostsOnLayer(deep);
  const hosts = layerHosts.map((host) => {
    // The terminal NPC is a coordinate-keyed box with sshd forced up; a child gateway
    // (router OR switch) takes its octet-keyed deep-gateway identity, so a switch child
    // resolves to its acl.conf box rather than aliasing the generic NPC tree.
    const identity =
      host.kind === 'machine'
        ? { machineId: hostMachineId(host, essid), baseFs: buildDeepHostFs(essid, host) }
        : resolveDeepGatewayIdentity(vantage.machineId, host.ip, host.kind);
    const ports = readOpenPorts(identity.baseFs).filter((openPort) => !deniedPorts.has(openPort.port));
    return { host, machineId: identity.machineId, ports };
  });
  return { subnet: deep.subnet, sourceIp: `${deep.subnet}.1`, hosts };
};
