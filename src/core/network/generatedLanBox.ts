/**
 * The machine an ESSID itself generated at a LAN address, as it stands right now.
 *
 * A forward on an access point's gateway can name a box nobody owns — an institution's
 * site server — as well as a player's. Every path that follows a forward from the
 * internet asks this one question the same way: is there such a machine, and is it up?
 * One answer, so a fetch and a scan can never disagree about whether the site is there.
 */

import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { canBoot } from '../boot/bootFiles';
import { materializeMachineFs, type OwnerPatchRow } from './materializeMachineFs';
import type { Directory } from '../filesystem/types';

export type FindMachinePatches = (query: {
  readonly machine_id: string;
}) => Promise<{ readonly data: readonly OwnerPatchRow[] | null; readonly error: unknown }>;

/** What stands at the address: a running box with its journal replayed, `absent` when no
 *  generated machine is there or the one there cannot boot, or `error` when its journal
 *  could not be read. */
export type GeneratedLanBox =
  | {
      readonly kind: 'up';
      readonly host: LanHost;
      readonly machineId: string;
      readonly fs: Directory;
    }
  | { readonly kind: 'absent' }
  | { readonly kind: 'error' };

export const generatedLanBox = async (
  findPatches: FindMachinePatches,
  essid: string,
  ip: string,
): Promise<GeneratedLanBox> => {
  const host = generateHomeLan(essid).hosts.find((candidate) => candidate.ip === ip);
  if (host === undefined) return { kind: 'absent' };
  const { machineId, baseFs } = resolveLanHostIdentity(host, essid);
  const patches = await findPatches({ machine_id: machineId });
  if (patches.error) return { kind: 'error' };
  const fs = materializeMachineFs(baseFs, patches.data);
  // A bricked box cannot come up, so the forward reaches a dead host — whatever its
  // document root still holds.
  return canBoot(fs).ok ? { kind: 'up', host, machineId, fs } : { kind: 'absent' };
};
