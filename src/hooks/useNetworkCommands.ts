import { useMemo } from 'react';
import { useNetwork } from '../network';
import { useFileSystem } from '../filesystem';
import { useSession } from '../session/SessionContext';
import { createIfconfigCommand } from '../commands/ifconfig';
import { createPingCommand } from '../commands/ping';
import { createNmapCommand } from '../commands/nmap';
import { createNslookupCommand } from '../commands/nslookup';
import { createSshCommand } from '../commands/ssh';
import { createFtpCommand } from '../commands/ftp';
import { createNcCommand } from '../commands/nc';
import { createCurlCommand } from '../commands/curl';
import { createExploitCommand } from '../commands/exploit';
import type { Command } from '../components/Terminal/types';

// Higher-order function that wraps a network command with WiFi connectivity gating.
// The isWifiRequired closure is evaluated at execution time (not wrap time), so it
// always reflects the current WiFi state.
const wrapWithWifiCheck = (cmd: Command, isWifiRequired: () => boolean): Command => ({
  ...cmd,
  fn: (...args: unknown[]) => {
    if (isWifiRequired()) {
      throw new Error('Network is unreachable — wlan0 is not connected');
    }
    return cmd.fn(...args);
  },
});

export const useNetworkCommands = (): Map<string, Command> => {
  const {
    getInterfaces,
    getInterface,
    getMachine,
    getMachines,
    getLocalIP,
    resolveDomain,
    getGateway,
    resolveNat,
  } = useNetwork();
  const { readFileFromMachine } = useFileSystem();
  const { session, wifiConnected } = useSession();

  return useMemo(() => {
    const isWifiRequired = () => session.machine === 'localhost' && !wifiConnected;

    const commands = new Map<string, Command>();

    commands.set(
      'ifconfig',
      createIfconfigCommand({
        getInterfaces,
        getInterface,
      }),
    );

    commands.set(
      'ping',
      wrapWithWifiCheck(createPingCommand({ getMachine, getMachines, getLocalIP }), isWifiRequired),
    );

    commands.set(
      'nmap',
      wrapWithWifiCheck(createNmapCommand({ getMachine, getMachines, getLocalIP }), isWifiRequired),
    );

    commands.set(
      'nslookup',
      wrapWithWifiCheck(createNslookupCommand({ resolveDomain, getGateway }), isWifiRequired),
    );

    commands.set(
      'ssh',
      wrapWithWifiCheck(createSshCommand({ getMachine, getLocalIP }), isWifiRequired),
    );

    commands.set(
      'ftp',
      wrapWithWifiCheck(
        createFtpCommand({ getMachine, getLocalIP, resolveDomain }),
        isWifiRequired,
      ),
    );

    commands.set(
      'nc',
      wrapWithWifiCheck(createNcCommand({ getMachine, getLocalIP, resolveDomain }), isWifiRequired),
    );

    commands.set(
      'curl',
      wrapWithWifiCheck(
        createCurlCommand({ getMachine, resolveDomain, resolveNat, readFileFromMachine }),
        isWifiRequired,
      ),
    );

    commands.set(
      'exploit',
      wrapWithWifiCheck(
        createExploitCommand({ getMachine, getLocalIP, resolveDomain }),
        isWifiRequired,
      ),
    );

    return commands;
  }, [
    getInterfaces,
    getInterface,
    getMachine,
    getMachines,
    getLocalIP,
    resolveDomain,
    getGateway,
    resolveNat,
    readFileFromMachine,
    session.machine,
    wifiConnected,
  ]);
};
