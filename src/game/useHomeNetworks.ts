import { useMemo } from 'react';
import { generateWifiNetworks } from '../generation/generateWifi';
import { generateHomeNetwork, type HomeNetwork } from '../generation/generateHomeNetwork';
import type { WifiConnection } from '../network/wifiTypes';

// Generates all home networks for a game seed and provides the active one
// based on which WiFi the player is connected to.
export const useHomeNetworks = (
  gameSeed: string | null,
  connectedWifi: WifiConnection | null,
): {
  readonly activeNetwork: HomeNetwork | null;
  readonly allNetworks: readonly HomeNetwork[];
} => {
  const allNetworks = useMemo((): readonly HomeNetwork[] => {
    if (!gameSeed) return [];
    const wifiNetworks = generateWifiNetworks(gameSeed);
    const crackable = wifiNetworks.filter((n) => n.crackable);
    const usedIps = new Set<string>();
    return crackable.map((wifi, i) => {
      const network = generateHomeNetwork(gameSeed, i, wifi.essid, usedIps);
      usedIps.add(network.router.publicIp);
      return network;
    });
  }, [gameSeed]);

  const activeNetwork = useMemo((): HomeNetwork | null => {
    if (!connectedWifi) return null;
    return allNetworks.find((n) => n.essid === connectedWifi.essid) ?? null;
  }, [connectedWifi, allNetworks]);

  return { activeNetwork, allNetworks };
};
