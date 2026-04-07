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
import { createNcCommand, ncPidFilePath } from '../commands/nc';
import { createCurlCommand } from '../commands/curl';
import { createMsfconsoleCommand } from '../commands/msfconsole';
import { createHydraCommand } from '../commands/hydra';
import { createGobusterCommand } from '../commands/gobuster';
import { createScpCommand } from '../commands/scp';
import { createDigCommand } from '../commands/dig';
import { createSnmpwalkCommand } from '../commands/snmpwalk';
import { createSnmpsetCommand } from '../commands/snmpset';
import { createMysqlCommand } from '../commands/mysql';
import { createRediscliCommand } from '../commands/rediscli';
import { wrapWithWifiCheck, wrapWithBrickedCheck } from '../commands/networkGuards';
import type { Command } from '../components/Terminal/types';
import { appendToMachineLog } from '../logging/appendToMachineLog';
import { formatAccessLog } from '../logging/formatters';
import { resolveLogSourceIP } from '../logging/utils';

export const useNetworkCommands = (): Map<string, Command> => {
  const {
    getInterfaces,
    getInterface,
    getMachine,
    getMachines,
    getLocalIP,
    getPublicIP,
    resolveDomain,
    getGateway,
    resolveNat,
    findMachineUsers,
    findMachineByIp,
  } = useNetwork();
  const {
    resolvePath,
    getNode,
    readFileFromMachine,
    getNodeFromMachine,
    createFileOnMachine,
    writeFileToMachine,
  } = useFileSystem();
  const { session, wifiConnected, isMachineBricked } = useSession();

  return useMemo(() => {
    const isWifiRequired = () => session.machine === 'localhost' && !wifiConnected;
    const logFs = { readFileFromMachine, writeFileToMachine, createFileOnMachine };
    const onHttpRequest = (
      targetIP: string,
      method: string,
      path: string,
      status: number,
      size: number,
    ) => {
      const sourceIP = resolveLogSourceIP(session.machine, targetIP, getLocalIP(), getPublicIP());
      const logLine = formatAccessLog(new Date(), sourceIP, method, path, status, size);
      appendToMachineLog(targetIP, '/var/log/access.log', logLine, logFs);
    };

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
          createNmapCommand({
            getMachine,
            findMachineByIp,
            getMachines,
            getLocalIPs: () => new Set(getInterfaces().map((iface) => iface.inet)),
            getLocalHostname: () => session.hostname ?? session.machine,
          }),
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
      'dig',
      wrapWithWifiCheck(
        createDigCommand({
          getMachine,
          getLocalIP,
          resolveDomain,
          getGateway,
          getNodeFromMachine,
        }),
        isWifiRequired,
      ),
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
      createNcCommand({
        getMachine,
        getLocalIP,
        resolveDomain,
        isWifiRequired,
        isMachineBricked,
        getListenAdapter: () => ({
          isPortOpen: (port) =>
            getMachine(session.machine)?.ports.some((p) => p.port === port && p.open) ?? false,
          pidFileExists: (port) => {
            const node = getNodeFromMachine(session.machine, ncPidFilePath(port), '/');
            return node !== null && node.type === 'file';
          },
          writePidFile: (port, content) =>
            createFileOnMachine({
              machineId: session.machine,
              path: ncPidFilePath(port),
              cwd: '/',
              content,
              userType: 'root',
            }),
          username: session.username,
          userType: session.userType,
        }),
      }),
    );

    commands.set(
      'curl',
      wrapWithBrickedCheck(
        wrapWithWifiCheck(
          createCurlCommand({
            getMachine,
            resolveDomain,
            resolveNat,
            readFileFromMachine,
            onHttpRequest,
          }),
          isWifiRequired,
        ),
        isMachineBricked,
      ),
    );

    commands.set(
      'msfconsole',
      wrapWithBrickedCheck(
        wrapWithWifiCheck(
          createMsfconsoleCommand({ getMachine, getLocalIP, resolveDomain }),
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
            getNodeFromMachine,
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
          createGobusterCommand({
            getMachine,
            resolveDomain,
            resolveNat,
            getNodeFromMachine,
            onHttpRequest,
          }),
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
      'snmpset',
      wrapWithBrickedCheck(
        wrapWithWifiCheck(
          createSnmpsetCommand({
            getMachine,
            getLocalIP,
            resolveDomain,
            getNodeFromMachine,
            writeFileToMachine,
          }),
          isWifiRequired,
        ),
        isMachineBricked,
      ),
    );

    commands.set(
      'mysql',
      wrapWithBrickedCheck(
        wrapWithWifiCheck(
          createMysqlCommand({ getMachine, findMachineByIp, getLocalIP, resolveDomain }),
          isWifiRequired,
        ),
        isMachineBricked,
      ),
    );

    commands.set(
      'rediscli',
      wrapWithBrickedCheck(
        wrapWithWifiCheck(
          createRediscliCommand({ getMachine, findMachineByIp, getLocalIP, resolveDomain }),
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
    writeFileToMachine,
    session.machine,
    session.hostname,
    session.currentPath,
    session.username,
    session.userType,
    wifiConnected,
    isMachineBricked,
  ]);
};
