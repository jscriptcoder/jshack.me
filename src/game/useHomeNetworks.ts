import { useEffect, useMemo, useState } from 'react';
import { generateWifiNetworks } from '../generation/generateWifi';
import {
  generateHomeNetwork,
  homeNetworkSeed,
  type HomeNetwork,
} from '../generation/generateHomeNetwork';
import type { WifiConnection } from '../network/wifiTypes';

// Generates all home networks for a game seed and provides the active one
// based on which WiFi the player is connected to.
//
// Generation is async (B2 onwards) because Phase 5 introduces a server
// round-trip for public-IP allocation during topology construction. Until
// the initial generation resolves, allNetworks is an empty array and
// activeNetwork is null — consumers render a "network loading" state or
// fall back to localhost-only views in that window.
export const useHomeNetworks = (
  gameSeed: string | null,
  connectedWifi: WifiConnection | null,
): {
  readonly activeNetwork: HomeNetwork | null;
  readonly allNetworks: readonly HomeNetwork[];
} => {
  const [allNetworks, setAllNetworks] = useState<readonly HomeNetwork[]>([]);

  useEffect(() => {
    if (!gameSeed) {
      setAllNetworks([]);
      return;
    }

    let cancelled = false;

    const generate = async (): Promise<void> => {
      const wifiNetworks = generateWifiNetworks(gameSeed);
      const crackable = wifiNetworks.filter((n) => n.crackable);
      const usedIps = new Set<string>();
      const networks: HomeNetwork[] = [];
      for (let i = 0; i < crackable.length; i++) {
        const wifi = crackable[i]!;
        const network = await generateHomeNetwork({
          seed: homeNetworkSeed(gameSeed, i),
          essid: wifi.essid,
          usedIps,
        });
        if (cancelled) return;
        usedIps.add(network.router.publicIp);
        networks.push(network);
      }
      if (!cancelled) setAllNetworks(networks);
    };

    void generate();
    return () => {
      cancelled = true;
    };
  }, [gameSeed]);

  const activeNetwork = useMemo((): HomeNetwork | null => {
    if (!connectedWifi) return null;
    return allNetworks.find((n) => n.essid === connectedWifi.essid) ?? null;
  }, [connectedWifi, allNetworks]);

  return { activeNetwork, allNetworks };
};
