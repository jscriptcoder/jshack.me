import { useMemo, useRef } from 'react';
import { useSession } from '../session/SessionContext';
import { createAirmonCommand } from '../commands/airmon';
import { createAirdumpCommand } from '../commands/airdump';
import { createAircrackCommand } from '../commands/aircrack';
import { createNmcliCommand } from '../commands/nmcli';
import type { Command } from '../components/Terminal/types';

export const useWifiCommands = (): Map<string, Command> => {
  const { session, connectedWifi, wifiConnected, setWifiConnected, disconnectWifi } = useSession();
  // Monitor mode is transient (not persisted) — resets on page refresh. Using useRef
  // instead of useState because it shouldn't trigger re-renders or persist to IndexedDB.
  const monitorModeRef = useRef(false);

  return useMemo(() => {
    const isOnLocalhost = () => session.machine === 'localhost';
    const isWifiConnected = () => wifiConnected;
    const isMonitorMode = () => monitorModeRef.current;
    const setMonitorMode = (enabled: boolean) => {
      monitorModeRef.current = enabled;
    };

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
      }),
    );

    commands.set(
      'aircrack',
      createAircrackCommand({
        isOnLocalhost,
        isMonitorMode,
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
      }),
    );

    return commands;
  }, [session.machine, connectedWifi, wifiConnected, setWifiConnected, disconnectWifi]);
};
