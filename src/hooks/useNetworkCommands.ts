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
import { createNcCommand, ncPidFilePath, startNcListener } from '../commands/nc';
import { createCurlCommand } from '../commands/curl';
import { createMsfconsoleCommand } from '../commands/msfconsole';
import { startSshd, SSH_PID_FILE_PATH, type SshdAdapter } from '../commands/sshd';
import { startVsftpd, FTP_PID_FILE_PATH, type VsftpdAdapter } from '../commands/vsftpd';
import { executeSystemctl, type SystemctlContext } from '../commands/systemctl';
import { listProcesses, type PsAdapter } from '../commands/ps';
import { executeScriptOnTarget } from '../utils/remoteScriptRunner';
import type { UserType } from '../session/SessionContext';
import type { MachineId } from '../filesystem/machineFileSystems';
import { createHydraCommand } from '../commands/hydra';
import { createGobusterCommand } from '../commands/gobuster';
import { createScpCommand } from '../commands/scp';
import { withTransientSession } from '../session/withTransientSession';
import { getIdentity } from '../identity';
import { createDigCommand } from '../commands/dig';
import { createSnmpwalkCommand } from '../commands/snmpwalk';
import { createSnmpsetCommand } from '../commands/snmpset';
import { createMysqlCommand } from '../commands/mysql';
import { createRediscliCommand } from '../commands/rediscli';
import { wrapWithWifiCheck, wrapWithBrickedCheck } from '../commands/networkGuards';
import type { Command } from '../components/Terminal/types';
import { appendToMachineLog } from '../logging/appendToMachineLog';
import { formatGobusterScanAggregate, formatNmapScanAggregate } from '../logging/formatters';
import { resolveLogSourceIP, resolveHostname } from '../logging/utils';
import { createExploitAttemptHandler } from '../logging/handlers/exploitAttempt';
import { createHttpRequestHandler } from '../logging/handlers/httpRequest';
import { createHydraLogHandler } from '../logging/handlers/hydraLog';
import { createNcConnectHandler } from '../logging/handlers/ncConnect';
import {
  chainForwardBackdoor,
  IPTABLES_PATH,
  type BackdoorForwardDeps,
} from '../network/backdoorForwarding';
import { applyVersionOverlay } from '../network/applyVersionOverlay';
import type { RemoteMachine } from '../network/types';
import { getGameTime } from '../session/gameTime';

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
    getGatewayChainFor,
  } = useNetwork();
  const {
    resolvePath,
    getNode,
    readFileFromMachine,
    getNodeFromMachine,
    createFileOnMachine,
    writeFileToMachine,
    listDirectoryFromMachine,
    deleteNodeFromMachine,
  } = useFileSystem();
  const { session, wifiConnected, isMachineBricked } = useSession();

  return useMemo(() => {
    const isWifiRequired = () => session.machine === 'localhost' && !wifiConnected;
    const logFs = { readFileFromMachine, writeFileToMachine, createFileOnMachine };

    // Phase 3 Step A: apply the /var/lib/apt/service_versions/<service> overlay
    // when reading any machine's ports. Commands (nmap, msfconsole) receive
    // overlay-aware views without needing to know the overlay exists.
    const withOverlay = (machine: RemoteMachine | undefined) =>
      machine === undefined ? undefined : applyVersionOverlay(machine, readFileFromMachine);
    const getEffectiveMachine = (ip: string) => withOverlay(getMachine(ip));
    const findEffectiveMachineByIp = (ip: string) => withOverlay(findMachineByIp(ip));
    const getEffectiveMachines = (): readonly RemoteMachine[] =>
      getMachines().map((m) => applyVersionOverlay(m, readFileFromMachine));
    const onHttpRequest = createHttpRequestHandler({
      sessionMachine: session.machine,
      getLocalIP,
      getPublicIP,
      resolveNat,
      logFs,
    });

    const onExploitAttempt = createExploitAttemptHandler({
      sessionMachine: session.machine,
      getLocalIP,
      getPublicIP,
      resolveNat,
      getMachine,
      getGameTime,
      logFs,
    });

    const onNcConnect = createNcConnectHandler({
      sessionMachine: session.machine,
      getLocalIP,
      getPublicIP,
      resolveNat,
      getMachine,
      logFs,
    });

    const onHydraBruteForceAggregate = createHydraLogHandler({
      sessionMachine: session.machine,
      getLocalIP,
      getPublicIP,
      resolveNat,
      getMachine,
      readFileFromMachine: (op) => readFileFromMachine(op),
      logFs,
    });

    const onScanAggregate = (info: {
      readonly targetIp: string;
      readonly probedPorts: readonly number[];
    }) => {
      const sourceIp = resolveLogSourceIP(
        session.machine,
        info.targetIp,
        getLocalIP(),
        getPublicIP(),
      );
      const hostname = resolveHostname(info.targetIp, getMachine);
      const line = formatNmapScanAggregate({
        date: new Date(),
        hostname,
        sourceIp,
        probedPorts: info.probedPorts,
      });
      appendToMachineLog(info.targetIp, '/var/log/kern.log', line, logFs);
    };

    const onGobusterScanAggregate = (info: {
      readonly targetIp: string;
      readonly port: number;
      readonly probedCount: number;
      readonly hitCount: number;
    }) => {
      const { ip: logIp } = resolveNat(info.targetIp, info.port);
      const sourceIp = resolveLogSourceIP(
        session.machine,
        info.targetIp,
        getLocalIP(),
        getPublicIP(),
      );
      const line = formatGobusterScanAggregate({
        date: new Date(),
        sourceIp,
        port: info.port,
        probedCount: info.probedCount,
        hitCount: info.hitCount,
      });
      appendToMachineLog(logIp, '/var/log/access.log', line, logFs);
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
            getMachine: getEffectiveMachine,
            findMachineByIp: findEffectiveMachineByIp,
            getMachines: getEffectiveMachines,
            getLocalIPs: () => new Set(getInterfaces().map((iface) => iface.inet)),
            getLocalHostname: () => session.hostname ?? session.machine,
            getGameTime,
            onScanAggregate,
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
        onNcConnect,
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

    // Builds a command context for running scripts on a target machine.
    // Provides the same daemon/system commands the player would have if
    // SSH'd into the machine at the given privilege tier.
    const buildTargetCommandContext = (
      machineId: string,
      tier: UserType,
    ): Readonly<Record<string, (...args: readonly unknown[]) => unknown>> => {
      const mid = machineId as MachineId;
      const machineInfo = getMachine(machineId);

      const sshdFn = (...args: unknown[]): string => {
        const adapter: SshdAdapter = {
          isPortOpen: (port) =>
            machineInfo?.ports.some((p) => p.port === port && p.service === 'ssh' && p.open) ??
            false,
          readPidFile: () => {
            const node = getNodeFromMachine(mid, SSH_PID_FILE_PATH, '/');
            return node?.type === 'file' ? (node.content ?? undefined) : undefined;
          },
          writePidFile: (content) =>
            createFileOnMachine({
              machineId: mid,
              path: SSH_PID_FILE_PATH,
              cwd: '/',
              content,
              userType: 'root',
            }),
        };
        return startSshd(adapter, args);
      };

      const vsftpdFn = (...args: unknown[]): string => {
        const adapter: VsftpdAdapter = {
          isPortOpen: (port) =>
            machineInfo?.ports.some((p) => p.port === port && p.service === 'ftp' && p.open) ??
            false,
          readPidFile: () => {
            const node = getNodeFromMachine(mid, FTP_PID_FILE_PATH, '/');
            return node?.type === 'file' ? (node.content ?? undefined) : undefined;
          },
          writePidFile: (content) =>
            createFileOnMachine({
              machineId: mid,
              path: FTP_PID_FILE_PATH,
              cwd: '/',
              content,
              userType: 'root',
            }),
        };
        return startVsftpd(adapter, args);
      };

      const systemctlFn = (...args: unknown[]): string => {
        const context: SystemctlContext = {
          getMachine: () => mid,
          getMachineInfo: (ip) => getMachine(ip),
          getNodeFromMachine,
          createFileOnMachine: (path, content, userType) =>
            createFileOnMachine({ machineId: mid, path, cwd: '/', content, userType }),
          deleteFileOnMachine: deleteNodeFromMachine,
        };
        return executeSystemctl(context, args);
      };

      const psFn = (): string => {
        const adapter: PsAdapter = {
          getMachineInfo: () => machineInfo,
          readDirectory: (path) => {
            const node = getNodeFromMachine(mid, path, '/');
            if (node?.type !== 'directory' || !node.children) return undefined;
            return Object.fromEntries(
              Object.entries(node.children)
                .filter(([, child]) => child.type === 'file' && child.content)
                .map(([name, child]) => [name, child.content!]),
            );
          },
        };
        const header = 'PID     USER       COMMAND';
        const rows = listProcesses(adapter).map(
          (p) => `${String(p.pid).padEnd(8)}${p.user.padEnd(11)}${p.command}`,
        );
        return [header, ...rows].join('\n');
      };

      const ncFn = (...args: unknown[]): string => {
        // Only listen mode in script context (no outbound connections)
        const adapter = {
          isPortOpen: (port: number) =>
            machineInfo?.ports.some((p) => p.port === port && p.open) ?? false,
          pidFileExists: (port: number) => {
            const node = getNodeFromMachine(mid, ncPidFilePath(port), '/');
            return node !== null;
          },
          writePidFile: (port: number, content: string) =>
            createFileOnMachine({
              machineId: mid,
              path: ncPidFilePath(port),
              cwd: '/',
              content,
              userType: 'root',
            }),
          username: tier === 'root' ? 'root' : 'user',
          userType: tier,
        };
        return startNcListener(adapter, args);
      };

      const catFn = (path: unknown): string => {
        if (typeof path !== 'string') throw new Error('cat: missing operand');
        return (
          readFileFromMachine({ machineId: mid, path, cwd: '/', userType: tier }) ??
          `cat: ${path}: No such file or directory`
        );
      };

      const lsFn = (path?: unknown): string => {
        const dir = typeof path === 'string' ? path : '/';
        const entries = listDirectoryFromMachine({
          machineId: mid,
          path: dir,
          cwd: '/',
          userType: tier,
        });
        return entries ? entries.join('  ') : `ls: ${dir}: No such file or directory`;
      };

      const echoFn = (...args: readonly unknown[]): string => args.map(String).join(' ');

      return {
        sshd: sshdFn,
        vsftpd: vsftpdFn,
        systemctl: systemctlFn,
        ps: psFn,
        nc: ncFn,
        cat: catFn,
        ls: lsFn,
        echo: echoFn,
      };
    };

    commands.set(
      'msfconsole',
      wrapWithBrickedCheck(
        wrapWithWifiCheck(
          createMsfconsoleCommand({
            getMachine: getEffectiveMachine,
            getLocalIP,
            getCurrentMachineId: () => session.machine,
            // Localhost isn't in the remote-machines list (it's the player's
            // workstation, generated separately via generateLocalhost), so
            // we synthesize a minimal RemoteMachine for it on demand. The
            // dispatch only needs `users` to resolve shell-effect tiers.
            getCurrentMachine: () => {
              if (session.machine !== 'localhost') {
                return getEffectiveMachine(session.machine);
              }
              return {
                ip: 'localhost',
                hostname: session.hostname ?? 'localhost',
                ports: [],
                users: [
                  { username: 'root', passwordHash: '', userType: 'root' },
                  { username: session.username, passwordHash: '', userType: 'user' },
                  { username: 'guest', passwordHash: '', userType: 'guest' },
                ],
              };
            },
            resolveDomain,
            getGameTime,
            onExploitAttempt,
            readRemoteFile: (machineId, path, tier = 'root') =>
              readFileFromMachine({ machineId, path, cwd: '/', userType: tier }),
            readLocalFile: (path) =>
              readFileFromMachine({
                machineId: session.machine,
                path,
                cwd: '/',
                userType: session.userType,
              }),
            // Wrap writeRemoteFile + runScriptOnTarget in transient
            // sessions (kind='effect_one_shot') so the L1 patch-validation
            // gate sees a session row at fire time. msfconsole's switch
            // cases await these callbacks (they were sync before; see
            // src/commands/msfconsole.ts MsfconsoleContext for the
            // signature change).
            writeRemoteFile: async (machineId, path, content, tier = 'root') => {
              await withTransientSession(
                getIdentity(),
                {
                  machine_id: machineId,
                  credentials: { username: 'msf', userType: tier },
                  kind: 'effect_one_shot',
                  ...(session.sessionId !== null && { parent_session_id: session.sessionId }),
                  source_ip: session.machine,
                },
                () => {
                  writeFileToMachine({ machineId, path, cwd: '/', userType: tier, content });
                },
              );
            },
            listRemoteDir: (machineId, path, tier = 'root') =>
              listDirectoryFromMachine({ machineId, path, cwd: '/', userType: tier }),
            runScriptOnTarget: async (machineId, scriptBody, tier) =>
              await withTransientSession(
                getIdentity(),
                {
                  machine_id: machineId,
                  credentials: { username: 'msf', userType: tier },
                  kind: 'effect_one_shot',
                  ...(session.sessionId !== null && { parent_session_id: session.sessionId }),
                  source_ip: session.machine,
                },
                () => executeScriptOnTarget(scriptBody, buildTargetCommandContext(machineId, tier)),
              ),
            openBackdoorForwards: (machineIp, port) => {
              const chain = getGatewayChainFor(machineIp);
              if (chain.length === 0) {
                return { publicEdgeIp: null, publicEdgePort: null };
              }
              const deps: BackdoorForwardDeps = {
                readIptables: (gwIp) =>
                  readFileFromMachine({
                    machineId: gwIp,
                    path: IPTABLES_PATH,
                    cwd: '/',
                    userType: 'root',
                  }),
                writeIptables: (gwIp, content) => {
                  writeFileToMachine({
                    machineId: gwIp,
                    path: IPTABLES_PATH,
                    cwd: '/',
                    userType: 'root',
                    content,
                  });
                },
              };
              const result = chainForwardBackdoor({
                machineIp,
                internalPort: port,
                gatewayChain: chain,
                deps,
              });
              const edge = chain[chain.length - 1]!;
              return { publicEdgeIp: edge.ip, publicEdgePort: result.publicEdgePort };
            },
          }),
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
            getLocalNode: (path: string) => getNode(resolvePath(path)),
            getCurrentPath: () => session.currentPath,
            onBruteForceAggregate: onHydraBruteForceAggregate,
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
            getLocalNode: (path: string) => getNode(resolvePath(path)),
            getCurrentPath: () => session.currentPath,
            onScanAggregate: onGobusterScanAggregate,
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
            withTransientSession: (params, body) =>
              withTransientSession(
                getIdentity(),
                {
                  machine_id: params.machine_id,
                  credentials: params.credentials,
                  kind: 'snmp',
                  ...(session.sessionId !== null && { parent_session_id: session.sessionId }),
                  source_ip: session.machine,
                },
                body,
              ),
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
            // Wraps the actual createFileOnMachine call in a transient
            // server session (kind='scp'). parent_session_id captures
            // the current shell so the server cascade-ends if the
            // player exits while scp is in flight; source_ip is the
            // machine the player is sitting in.
            withTransientSession: (params, body) =>
              withTransientSession(
                getIdentity(),
                {
                  machine_id: params.machine_id,
                  credentials: params.credentials,
                  kind: 'scp',
                  ...(session.sessionId !== null && { parent_session_id: session.sessionId }),
                  source_ip: session.machine,
                },
                body,
              ),
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
    deleteNodeFromMachine,
    listDirectoryFromMachine,
    session.machine,
    session.hostname,
    session.currentPath,
    session.username,
    session.userType,
    session.sessionId,
    wifiConnected,
    isMachineBricked,
    findMachineByIp,
    getGatewayChainFor,
    getPublicIP,
  ]);
};
