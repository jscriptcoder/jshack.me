import { useEffect, useState } from 'react';
import type { FileNode } from '../filesystem/types';
import { generateMissionNetwork } from '../generation/generateMission';
import { listTestNetworks } from './client';
import { generateTestNetworkFileSystems } from './generate';

// Hook for the dev-only test network playground. Fetches the
// test_networks list at mount, generates each via the mission generator
// (with a fake allocator pinning the test network's public_ip so all
// players get identical machine_ids), and exposes the merged
// fileSystems map.
//
// Returns an empty Record while the fetch + generation are in flight,
// or if env vars / DB are unavailable. Graceful degradation matches
// listTestNetworks's behaviour — the app keeps working without test
// networks if the table can't be reached.
//
// Consumers (App.tsx) merge this into FileSystemProvider's
// homeFileSystems prop, which feeds the patches rehydration +
// Realtime subscription paths through the normal cross-player
// visibility plumbing.
//
// REMOVED AT GAME RELEASE: drop this hook, the import in App.tsx, and
// the merge call. See plans/test-networks-playground.md.
export const useTestNetworks = (): Readonly<Record<string, FileNode>> => {
  const [fileSystems, setFileSystems] = useState<Readonly<Record<string, FileNode>>>({});

  useEffect(() => {
    let cancelled = false;

    const fetchAndGenerate = async (): Promise<void> => {
      const testNetworks = await listTestNetworks();
      if (cancelled || testNetworks.length === 0) return;
      const fs = await generateTestNetworkFileSystems(testNetworks, generateMissionNetwork);
      if (cancelled) return;
      setFileSystems(fs);
    };

    void fetchAndGenerate();
    return () => {
      cancelled = true;
    };
  }, []);

  return fileSystems;
};
