import { useMemo, useRef } from 'react';
import { useSession } from '../session/SessionContext';
import { useHomeNetworks } from '../game/HomeNetworksContext';
import { isOwnWorkstation } from '../homeNetworks/homeNetworkHelpers';
import { createAirmonCommand } from '../commands/airmon';
import { createAirdumpCommand } from '../commands/airdump';
import { createAircrackCommand } from '../commands/aircrack';
import { createNmcliCommand } from '../commands/nmcli';
import { generateWifiNetworks } from '../generation/generateWifi';
import { WIFI_NETWORKS } from '../network/wifiNetworks';
import type { WifiNetwork } from '../network/wifiNetworks';
import type { Command } from '../components/Terminal/types';
import { getCachedGameState } from '../utils/storageCache';

export const useWifiCommands = (): Map<string, Command> => {
  const gameSeed = getCachedGameState()?.seed ?? null;
  const { session, connectedWifi, wifiConnected, setWifiConnected, disconnectWifi, hostname } =
    useSession();
  const { ensureJoined, activeNetwork } = useHomeNetworks();
  // Monitor mode is transient (not persisted) — resets on page refresh. Using useRef
  // instead of useState because it shouldn't trigger re-renders or persist to IndexedDB.
  const monitorModeRef = useRef(false);

  // Generate WiFi networks from seed, or fall back to static networks
  const wifiNetworks = useMemo(
    (): readonly WifiNetwork[] => (gameSeed ? generateWifiNetworks(gameSeed) : WIFI_NETWORKS),
    [gameSeed],
  );

  return useMemo(() => {
    // "On localhost" in the WiFi-command sense = on the player's own
    // workstation (the only place WiFi commands work). The legacy
    // 'localhost' literal is no longer the storage key — session.machine
    // holds the workstation_id (= hostname) when sitting on the player's
    // own machine.
    const isOnLocalhost = () => isOwnWorkstation(session.machine, hostname);
    const isWifiConnected = () => wifiConnected;
    const isMonitorMode = () => monitorModeRef.current;
    const setMonitorMode = (enabled: boolean) => {
      monitorModeRef.current = enabled;
    };
    const getWifiNetworks = () => wifiNetworks;

    const commands = new Map<string, Command>();

    commands.set(
      'airmon',
      createAirmonCommand({
        isOnLocalhost,
        isWifiConnected,
        isMonitorMode,
        setMonitorMode,
      }),
    );

    commands.set(
      'airdump',
      createAirdumpCommand({
        isOnLocalhost,
        isMonitorMode,
        getWifiNetworks,
      }),
    );

    commands.set(
      'aircrack',
      createAircrackCommand({
        isOnLocalhost,
        isMonitorMode,
        getWifiNetworks,
      }),
    );

    commands.set(
      'nmcli',
      createNmcliCommand({
        isOnLocalhost,
        isWifiConnected,
        connectedEssid: () => connectedWifi?.essid ?? null,
        setWifiConnected,
        disconnectWifi,
        getWifiNetworks,
        ensureJoined,
        getActiveHomeNetwork: () => activeNetwork,
      }),
    );

    return commands;
  }, [
    session.machine,
    hostname,
    connectedWifi,
    wifiConnected,
    setWifiConnected,
    disconnectWifi,
    wifiNetworks,
    ensureJoined,
    activeNetwork,
  ]);
};
