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
import { createScpCommand } from '../commands/scp';
import { createSnmpwalkCommand } from '../commands/snmpwalk';
import { wrapWithWifiCheck, wrapWithBrickedCheck } from '../commands/networkGuards';
import type { Command } from '../components/Terminal/types';

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
    findMachineUsers,
  } = useNetwork();
  const { resolvePath, getNode, readFileFromMachine, getNodeFromMachine, createFileOnMachine } =
    useFileSystem();
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
          createHydraCommand({
            getMachine,
            getLocalIP,
            resolveDomain,
            resolveNat,
            findMachineUsers,
          }),
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

    commands.set(
      'snmpwalk',
      wrapWithBrickedCheck(
        wrapWithWifiCheck(
          createSnmpwalkCommand({ getMachine, getLocalIP, resolveDomain, getNodeFromMachine }),
          isWifiRequired,
        ),
        isMachineBricked,
      ),
    );

    commands.set(
      'scp',
      wrapWithBrickedCheck(
        wrapWithWifiCheck(
          createScpCommand({
            getMachine,
            getLocalIP,
            getCurrentMachine: () => session.machine,
            getCurrentPath: () => session.currentPath,
            resolvePath: (path: string) => resolvePath(path),
            getNode: (path: string) => getNode(path),
            getNodeFromMachine,
            createFileOnMachine,
            resolveNat,
          }),
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
    findMachineUsers,
    resolvePath,
    getNode,
    readFileFromMachine,
    getNodeFromMachine,
    createFileOnMachine,
    session.machine,
    session.currentPath,
    wifiConnected,
    isMachineBricked,
  ]);
};
