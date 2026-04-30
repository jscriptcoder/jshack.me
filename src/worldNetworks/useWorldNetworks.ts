import { useEffect, useState } from 'react';
import { generateMissionNetwork } from '../generation/generateMission';
import type { MissionNetwork } from '../generation/types';
import { listWorldNetworks } from './client';
import { generateWorldNetworks } from './generate';

// Hook for the production world_networks feature. Fetches the list at
// mount, generates each row's full network via the mission generator
// (with a fake allocator pinning the row's public_ip so all players
// get identical machine_ids), and exposes the array.
//
// Returns an empty array while the fetch + generation are in flight,
// or if env vars / DB are unavailable. Graceful degradation matches
// listWorldNetworks's behaviour — the app keeps working without world
// networks if the table can't be reached.
//
// Consumers (App.tsx) destructure each network's fileSystems for
// FileSystemProvider AND pass the whole array to NetworkProvider so
// network commands (nmap / ssh / curl / etc.) can resolve world
// machine IPs. Returning the full MissionNetwork array (not just a
// merged Record<string, FileNode>) is the correction vs the
// abandoned PR #83.
export const useWorldNetworks = (): ReadonlyArray<MissionNetwork> => {
  const [networks, setNetworks] = useState<ReadonlyArray<MissionNetwork>>([]);

  useEffect(() => {
    let cancelled = false;

    const fetchAndGenerate = async (): Promise<void> => {
      const rows = await listWorldNetworks();
      if (cancelled || rows.length === 0) return;
      const generated = await generateWorldNetworks(rows, generateMissionNetwork);
      if (cancelled) return;
      setNetworks(generated);
    };

    void fetchAndGenerate();
    return () => {
      cancelled = true;
    };
  }, []);

  return networks;
};
