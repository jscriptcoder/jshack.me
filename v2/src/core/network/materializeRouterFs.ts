/**
 * materializeApGatewayFs — rebuild an access point's GATEWAY the way every
 * cross-player server path needs it (Story 5.1.1b): the SEEDED router base FS
 * (a root-only box bearing its own `sshd:22`, both recovered from the owner key
 * alone — decision D6) with the router's persisted patch journal replayed over it
 * (the shared `materializeMachineFs` step).
 *
 * The router counterpart of `materializeWorkstationFs`: the public SCAN
 * (`resolvePublicScan`) and — later — the public SSH gate resolve the router
 * through this one builder, so they agree on what the box looks like, including
 * whether a `/boot` tombstone has bricked it. The owner-key → secret derivation
 * (admin password + sshd presence) lives HERE, at the composing layer, keeping
 * `buildRouterBaseFsFromIdentity` a pure function of (root hash, sshd-on?).
 */

import { materializeMachineFs, type OwnerPatchRow } from './materializeMachineFs';
import { buildApGatewayBaseFs } from '../generation/routerFs';
import type { Directory } from '../filesystem/types';

/** The network identity the gateway base is reconstructed from — the ESSID alone
 *  seeds the admin password and sshd presence, because the gateway belongs to the
 *  access point rather than to any occupant. */
export type ApGatewayIdentity = { readonly essid: string };

/** Rebuild the AP's REAL gateway: the seeded base (admin pw + sshd recovered from
 *  the ESSID) with the machine's persisted journal replayed over it. Every occupant
 *  of the ESSID rebuilds the same box, so a write by one is seen by all. */
export const materializeApGatewayFs = (
  network: ApGatewayIdentity,
  patches: readonly OwnerPatchRow[] | null,
): Directory => materializeMachineFs(buildApGatewayBaseFs(network.essid), patches);
