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
import { createHydraCommand } from '../commands/hydra';
import { createGobusterCommand } from '../commands/gobuster';
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

// Wraps a network command with a bricked machine check. Extracts the target IP
// from the first string argument and checks if that machine has been bricked.
const wrapWithBrickedCheck = (
  cmd: Command,
  isMachineBricked: (machine: string) => boolean,
): Command => ({
  ...cmd,
  fn: (...args: unknown[]) => {
    const target = args.find((arg) => typeof arg === 'string') as string | undefined;
    if (target && isMachineBricked(target)) {
      throw new Error(`Connection timed out — host ${target} appears to be down`);
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
  const { readFileFromMachine, getNodeFromMachine } = useFileSystem();
  const { session, wifiConnected, isMachineBricked } = useSession();

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
      wrapWithBrickedCheck(
        wrapWithWifiCheck(
          createPingCommand({ getMachine, getMachines, getLocalIP }),
          isWifiRequired,
        ),
        isMachineBricked,
      ),
    );

    commands.set(
      'nmap',
      wrapWithBrickedCheck(
        wrapWithWifiCheck(
          createNmapCommand({ getMachine, getMachines, getLocalIP }),
          isWifiRequired,
        ),
        isMachineBricked,
      ),
    );

    commands.set(
      'nslookup',
      wrapWithWifiCheck(createNslookupCommand({ resolveDomain, getGateway }), isWifiRequired),
    );

    commands.set(
      'ssh',
      wrapWithBrickedCheck(
        wrapWithWifiCheck(createSshCommand({ getMachine, getLocalIP }), isWifiRequired),
        isMachineBricked,
      ),
    );

    commands.set(
      'ftp',
      wrapWithBrickedCheck(
        wrapWithWifiCheck(
          createFtpCommand({ getMachine, getLocalIP, resolveDomain }),
          isWifiRequired,
        ),
        isMachineBricked,
      ),
    );

    commands.set(
      'nc',
      wrapWithBrickedCheck(
        wrapWithWifiCheck(
          createNcCommand({ getMachine, getLocalIP, resolveDomain }),
          isWifiRequired,
        ),
        isMachineBricked,
      ),
    );

    commands.set(
      'curl',
      wrapWithBrickedCheck(
        wrapWithWifiCheck(
          createCurlCommand({ getMachine, resolveDomain, resolveNat, readFileFromMachine }),
          isWifiRequired,
        ),
        isMachineBricked,
      ),
    );

    commands.set(
      'exploit',
      wrapWithBrickedCheck(
        wrapWithWifiCheck(
          createExploitCommand({ getMachine, getLocalIP, resolveDomain }),
          isWifiRequired,
        ),
        isMachineBricked,
      ),
    );

    commands.set(
      'hydra',
      wrapWithBrickedCheck(
        wrapWithWifiCheck(
          createHydraCommand({ getMachine, getLocalIP, resolveDomain }),
          isWifiRequired,
        ),
        isMachineBricked,
      ),
    );

    commands.set(
      'gobuster',
      wrapWithBrickedCheck(
        wrapWithWifiCheck(
          createGobusterCommand({ getMachine, resolveDomain, resolveNat, getNodeFromMachine }),
          isWifiRequired,
        ),
        isMachineBricked,
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
    getNodeFromMachine,
    session.machine,
    wifiConnected,
    isMachineBricked,
  ]);
};
