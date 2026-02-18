import { useMemo, useRef } from 'react';
import { useSession } from '../session/SessionContext';
import { createAirmonCommand } from '../commands/airmon';
import { createAirdumpCommand } from '../commands/airdump';
import { createAircrackCommand } from '../commands/aircrack';
import type { Command } from '../components/Terminal/types';

export const useWifiCommands = (): Map<string, Command> => {
  const { session, setWifiConnected } = useSession();
  const monitorModeRef = useRef(false);

  return useMemo(() => {
    const isOnLocalhost = () => session.machine === 'localhost';
    const isWifiConnected = () => session.wifiConnected;
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
        setWifiConnected,
      }),
    );

    return commands;
  }, [session.machine, session.wifiConnected, setWifiConnected]);
};
