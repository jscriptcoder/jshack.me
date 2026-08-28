/**
 * The `/24` a device's forwards may point INTO — the network it fronts, which is not
 * the network it stands on unless it happens to be the edge.
 *
 * A NAT forward names a box behind the device. The access point's gateway fronts the
 * LAN its own address sits on, so for that one device the two are the same segment; an
 * inner gateway fronts the hidden layer BEHIND it, and a destination on the LAN it
 * stands on is a DNAT target nothing answers at. Judged by the address a player typed
 * instead of the device reached, the answer is right for the edge and wrong for
 * everything deeper.
 *
 * Resolved from `(essid, machineId)` and never from anything the client said, and
 * through `generateDeepLayer` itself rather than a second derivation of the same seed —
 * so the bound a write is refused by and the chain walk that later resolves that
 * forward cannot come to disagree about where the boxes behind a device stand.
 *
 * `kind` is the device's own, passed rather than assumed: today it decides only whether
 * the generated layer hangs a child gateway, which this caller discards, but inventing
 * one here would be this function holding an opinion about a device it was told about.
 *
 * A switch is never asked. It has no forward table at all, so the write that would
 * consult this is already refused for naming an OID the device does not implement.
 */

import { generateHomeLan, type LanHostKind } from '../generation/generateHomeLan';
import { generateDeepLayer } from '../generation/generateDeepLayer';
import { computeApGatewayId } from '../identity/router';

export const frontedSegment = (device: {
  readonly essid: string;
  readonly machineId: string;
  readonly kind: LanHostKind;
}): string =>
  device.machineId === computeApGatewayId(device.essid)
    ? generateHomeLan(device.essid).subnet
    : generateDeepLayer(device.essid, { machineId: device.machineId, kind: device.kind }).subnet;
