/**
 * materializeRouterFs — rebuild a registered player's ROUTER the way every
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
import { buildRouterBaseFs } from '../generation/routerFs';
import type { Directory } from '../filesystem/types';

/** The registry identity the router base is reconstructed from — the owner's
 *  verified pubkey alone seeds the admin password and sshd presence. */
export type RouterIdentity = { readonly owner_key: string };

/** Rebuild the owner's REAL router: the seeded base (admin pw + sshd recovered
 *  from `owner_key`) with the machine's persisted journal replayed over it. */
export const materializeRouterFs = (
  registry: RouterIdentity,
  patches: readonly OwnerPatchRow[] | null,
): Directory => materializeMachineFs(buildRouterBaseFs(registry.owner_key), patches);
