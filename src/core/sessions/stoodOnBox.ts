/**
 * resolveStoodOnBox — which machine a shell is standing on, for the server actions typed
 * into that shell (`su`, `msfconsole --local`).
 *
 * The machine is found from the network on the caller's own session row, never from the
 * request: that network's own gateway, a machine it generates, or else another player's
 * workstation, found through occupancy. An id that row's network does not make can only
 * be somebody's workstation, so the gateway of any other network cannot be reached by
 * naming it.
 *
 * What comes back is the box as it was generated. The caller replays the journal over it.
 */

import { buildWorkstationBaseFsFromIdentity } from '../generation/workstationFs.js';
import { networkBaseFsForMachineId } from '../generation/lanHostIdentity.js';
import { hostnameForMachineId } from '../generation/lanTopology.js';
import { apGatewayLogWriterKey } from '../logging/apGatewayLogWriter.js';
import type { Directory } from '../filesystem/types.js';

/** The occupancy row of another player's workstation: who owns it (the key its logs file
 *  under), the persisted identity its tree is rebuilt from, and the name it answers to.
 *  The network on it is not read here: one player on several access points has a row on
 *  each, and the one the shell is on is the one its own session row names. */
export type OccupantWorkstation = {
  readonly owner_key: string;
  readonly workstation_machine_id: string;
  readonly essid: string;
  readonly workstation_username: string;
  /** The owner's player-chosen workstation hostname, which the box's log lines carry. */
  readonly workstation_machine_name: string;
  readonly workstation_root_hash: string;
};

/** Whose workstation this is, from `home_network_occupants`. Asked only for a machine the
 *  shell's network does not make. Occupancy means "this machine is on that WiFi", so a
 *  box whose owner has taken it off the network resolves to nothing. */
export type FindOccupantWorkstationByMachineId = (
  machineId: string,
) => Promise<{ readonly data: OccupantWorkstation | null; readonly error: unknown }>;

/** The box a shell stands on: its tree as generated, the name it answers to, and the
 *  journal row its own log lines accrete under. */
export type StoodOnBox = {
  readonly machineId: string;
  readonly baseFs: Directory;
  readonly hostname: string;
  readonly logWriterKey: string;
};

export type StoodOnBoxResult =
  | { readonly ok: true; readonly box: StoodOnBox }
  | { readonly ok: false; readonly status: number; readonly error: string };

export const resolveStoodOnBox = async (
  findOccupantWorkstationByMachineId: FindOccupantWorkstationByMachineId,
  machineId: string,
  essid: string,
): Promise<StoodOnBoxResult> => {
  // A machine the shell's own network makes belongs to nobody, so every caller's line on
  // it files under the network's key, where one would otherwise erase another.
  const networkFs = networkBaseFsForMachineId(essid, machineId);
  if (networkFs !== null) {
    return {
      ok: true,
      box: {
        machineId,
        baseFs: networkFs,
        // A deep machine has no name the topology knows, and its id leads with one.
        hostname: hostnameForMachineId(essid, machineId) ?? machineId,
        logWriterKey: apGatewayLogWriterKey(essid),
      },
    };
  }

  // Otherwise it is another player's workstation. Occupancy is both its identity and its
  // reachability: a machine on no WiFi is not there to stand on.
  const occupant = await findOccupantWorkstationByMachineId(machineId);
  if (occupant.error) {
    return { ok: false, status: 500, error: 'occupant_lookup_failed' };
  }
  if (occupant.data === null) {
    return { ok: false, status: 404, error: 'host_unreachable' };
  }
  return {
    ok: true,
    box: {
      machineId,
      baseFs: buildWorkstationBaseFsFromIdentity({
        ownerKeyHex: occupant.data.owner_key,
        username: occupant.data.workstation_username,
        rootPasswordHash: occupant.data.workstation_root_hash,
      }),
      hostname: occupant.data.workstation_machine_name,
      logWriterKey: occupant.data.owner_key,
    },
  };
};
