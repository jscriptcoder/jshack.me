import { useNetwork } from '../network';
import { useFileSystem } from '../filesystem';
import { useSession } from '../session/SessionContext';
import { useHomeNetworks } from '../homeNetworks/HomeNetworksContext';
import { useForeignNetworks } from '../foreignNetworks/ForeignNetworksContext';
import {
  buildResolveTargetMachineId,
  isOwnWorkstation,
  parseWorkstationId,
} from '../homeNetworks/homeNetworkHelpers';
import { exploitRead, crackCredentials } from '../patchRegistry/client';
import { createIfconfigCommand } from '../commands/ifconfig';
import { createPingCommand } from '../commands/ping';
import { createNmapCommand } from '../commands/nmap';
import { createNslookupCommand } from '../commands/nslookup';
import { createSshCommand } from '../commands/ssh';
import { createFtpCommand } from '../commands/ftp';
import { createNcCommand, ncPidFilePath, startNcListener } from '../commands/nc';
import { createCurlCommand } from '../commands/curl';
import { createLynxCommand } from '../commands/lynx';
import { buildLynxFetch, type LynxFetch } from '../commands/lynx/fetch';
import { createMsfconsoleCommand } from '../commands/msfconsole';
import { startSshd, SSH_PID_FILE_PATH, type SshdAdapter } from '../commands/sshd';
import { startVsftpd, FTP_PID_FILE_PATH, type VsftpdAdapter } from '../commands/vsftpd';
import { executeSystemctl, type SystemctlContext } from '../commands/systemctl';
import { listProcesses, type PsAdapter } from '../commands/ps';
import { executeScriptOnTarget } from '../utils/remoteScriptRunner';
import type { UserType } from '../session/types';
import type { MachineId } from '../filesystem/machineFileSystems';
import { createHydraCommand } from '../commands/hydra';
import { createGobusterCommand } from '../commands/gobuster';
import { createScpCommand } from '../commands/scp';
import { withTransientSession } from '../session/withTransientSession';
import { withTransientAuthSession } from '../session/withTransientAuthSession';
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
import { applyVersionOverlay } from '../network/applyVersionOverlay';
import type { RemoteMachine } from '../network/types';
import { getGameTime } from '../session/gameTime';

export type UseNetworkCommandsResult = {
  readonly commands: Map<string, Command>;
  readonly lynxFetch: LynxFetch;
};

export const useNetworkCommands = (): UseNetworkCommandsResult => {
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
    findMachineByIpAsync,
    getHandler,
  } = useNetwork();
  const {
    resolvePath,
    getNode,
    readFileFromMachine,
    getNodeFromMachine,
    createFileOnMachine,
    writeFileToMachine,
    upsertFileOnMachine,
    listDirectoryFromMachine,
    deleteNodeFromMachine,
    flushPendingPatches,
    awaitCrossPlayerBaseFs,
  } = useFileSystem();
  const { session, wifiConnected, isMachineBricked, hostname } = useSession();
  const { activeNetwork, lanOccupants } = useHomeNetworks();
  const { foreignNetworks, foreignLanOccupants } = useForeignNetworks();

  const resolveTargetMachineId = buildResolveTargetMachineId(
    activeNetwork,
    lanOccupants,
    hostname,
    foreignNetworks,
    foreignLanOccupants,
  );

  const isWifiRequired = () => isOwnWorkstation(session.machine, hostname) && !wifiConnected;

  const logFs = {
    readFileFromMachine: (op: Parameters<typeof readFileFromMachine>[0]) =>
      readFileFromMachine({ ...op, machineId: resolveTargetMachineId(op.machineId) }),
    writeFileToMachine: (op: Parameters<typeof writeFileToMachine>[0]) =>
      writeFileToMachine({ ...op, machineId: resolveTargetMachineId(op.machineId) }),
    createFileOnMachine: (op: Parameters<typeof createFileOnMachine>[0]) =>
      createFileOnMachine({ ...op, machineId: resolveTargetMachineId(op.machineId) }),
  };

  const withOverlay = (machine: RemoteMachine | undefined) =>
    machine === undefined ? undefined : applyVersionOverlay(machine, readFileFromMachine);
  const getEffectiveMachine = (ip: string) => withOverlay(getMachine(ip));
  const findEffectiveMachineByIp = (ip: string) => withOverlay(findMachineByIp(ip));
  const findEffectiveMachineByIpAsync = async (ip: string): Promise<RemoteMachine | undefined> =>
    withOverlay(await findMachineByIpAsync(ip));
  const getEffectiveMachines = (): readonly RemoteMachine[] =>
    getMachines().map((m) => applyVersionOverlay(m, readFileFromMachine));

  const onHttpRequest = createHttpRequestHandler({
    sessionMachine: session.machine,
    ownWorkstationId: hostname,
    getLocalIP,
    getPublicIP,
    resolveNat,
    logFs,
  });

  const onExploitAttempt = createExploitAttemptHandler({
    sessionMachine: session.machine,
    ownWorkstationId: hostname,
    getLocalIP,
    getPublicIP,
    resolveNat,
    getMachine,
    getGameTime,
    logFs,
  });

  const onNcConnect = createNcConnectHandler({
    sessionMachine: session.machine,
    ownWorkstationId: hostname,
    getLocalIP,
    getPublicIP,
    resolveNat,
    getMachine,
    logFs,
  });

  const onHydraBruteForceAggregate = createHydraLogHandler({
    sessionMachine: session.machine,
    ownWorkstationId: hostname,
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
      hostname,
      info.targetIp,
      getLocalIP(),
      getPublicIP(),
    );
    const targetHostname = resolveHostname(info.targetIp, getMachine);
    const line = formatNmapScanAggregate({
      date: new Date(),
      hostname: targetHostname,
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
      hostname,
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

  const buildTargetCommandContext = (
    machineId: string,
    tier: UserType,
  ): Readonly<Record<string, (...args: readonly unknown[]) => unknown>> => {
    const mid: MachineId = machineId;
    const machineInfo = getMachine(machineId);

    const sshdFn = (...args: unknown[]): string => {
      const adapter: SshdAdapter = {
        isPortOpen: (port) =>
          machineInfo?.ports.some((p) => p.port === port && p.service === 'ssh' && p.open) ?? false,
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
          machineInfo?.ports.some((p) => p.port === port && p.service === 'ftp' && p.open) ?? false,
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
          findMachineByIpAsync: findEffectiveMachineByIpAsync,
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
      wrapWithWifiCheck(
        createSshCommand({
          getMachine,
          findMachineByIpAsync: findEffectiveMachineByIpAsync,
          getLocalIP,
        }),
        isWifiRequired,
      ),
      isMachineBricked,
    ),
  );

  commands.set(
    'ftp',
    wrapWithBrickedCheck(
      wrapWithWifiCheck(
        createFtpCommand({
          getMachine,
          findMachineByIpAsync: findEffectiveMachineByIpAsync,
          getLocalIP,
          resolveDomain,
        }),
        isWifiRequired,
      ),
      isMachineBricked,
    ),
  );

  commands.set(
    'nc',
    createNcCommand({
      getMachine,
      findMachineByIpAsync: findEffectiveMachineByIpAsync,
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
          findMachineByIpAsync: findEffectiveMachineByIpAsync,
          resolveDomain,
          resolveNat,
          readFileFromMachine: (op) =>
            readFileFromMachine({ ...op, machineId: resolveTargetMachineId(op.machineId) }),
          onHttpRequest,
          getHandler,
        }),
        isWifiRequired,
      ),
      isMachineBricked,
    ),
  );

  commands.set(
    'lynx',
    wrapWithBrickedCheck(wrapWithWifiCheck(createLynxCommand(), isWifiRequired), isMachineBricked),
  );

  commands.set(
    'msfconsole',
    wrapWithBrickedCheck(
      wrapWithWifiCheck(
        createMsfconsoleCommand({
          getMachine: getEffectiveMachine,
          findMachineByIp: findEffectiveMachineByIp,
          findMachineByIpAsync: findEffectiveMachineByIpAsync,
          getLocalIP,
          resolveNat,
          getCurrentMachineId: () => session.machine,
          getCurrentMachine: () => {
            if (!isOwnWorkstation(session.machine, hostname)) {
              return getEffectiveMachine(session.machine);
            }
            return {
              ip: hostname,
              hostname: session.hostname ?? hostname,
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
          writeRemoteFile: async (machineId, path, content, tier = 'root') => {
            const canonicalMachineId = resolveTargetMachineId(machineId);
            let writeResult: { allowed: boolean; error?: string } = { allowed: false };
            await withTransientSession(
              getIdentity(),
              {
                machine_id: canonicalMachineId,
                credentials: { username: 'msf', userType: tier },
                kind: 'effect_one_shot',
                ...(session.sessionId !== null && { parent_session_id: session.sessionId }),
                source_ip: session.machine,
              },
              async () => {
                writeResult = upsertFileOnMachine({
                  machineId: canonicalMachineId,
                  path,
                  cwd: '/',
                  userType: tier,
                  content,
                });
                await flushPendingPatches();
              },
            );
            return writeResult;
          },
          listRemoteDir: (machineId, path, tier = 'root') =>
            listDirectoryFromMachine({ machineId, path, cwd: '/', userType: tier }),
          exploitFileRead: async (machineId, path, tier) => {
            const canonical = resolveTargetMachineId(machineId);
            const isCrossPlayerWorkstation =
              parseWorkstationId(canonical) !== undefined &&
              !isOwnWorkstation(canonical, hostname);
            if (isCrossPlayerWorkstation) {
              const result = await withTransientSession(
                getIdentity(),
                {
                  machine_id: canonical,
                  credentials: { username: 'msf', userType: tier },
                  kind: 'effect_one_shot',
                  ...(session.sessionId !== null && { parent_session_id: session.sessionId }),
                  source_ip: session.machine,
                },
                () => exploitRead(getIdentity(), canonical, path, 'file_read'),
              );
              return typeof result === 'string' ? result : null;
            }
            return readFileFromMachine({ machineId, path, cwd: '/', userType: tier });
          },
          exploitDirList: async (machineId, path, tier) => {
            const canonical = resolveTargetMachineId(machineId);
            const isCrossPlayerWorkstation =
              parseWorkstationId(canonical) !== undefined &&
              !isOwnWorkstation(canonical, hostname);
            if (isCrossPlayerWorkstation) {
              const result = await withTransientSession(
                getIdentity(),
                {
                  machine_id: canonical,
                  credentials: { username: 'msf', userType: tier },
                  kind: 'effect_one_shot',
                  ...(session.sessionId !== null && { parent_session_id: session.sessionId }),
                  source_ip: session.machine,
                },
                () => exploitRead(getIdentity(), canonical, path, 'dir_list'),
              );
              return Array.isArray(result) ? result : null;
            }
            return listDirectoryFromMachine({ machineId, path, cwd: '/', userType: tier });
          },
          runScriptOnTarget: async (machineId, scriptBody, tier) => {
            const canonicalMachineId = resolveTargetMachineId(machineId);
            return await withTransientSession(
              getIdentity(),
              {
                machine_id: canonicalMachineId,
                credentials: { username: 'msf', userType: tier },
                kind: 'effect_one_shot',
                ...(session.sessionId !== null && { parent_session_id: session.sessionId }),
                source_ip: session.machine,
              },
              async () => {
                const result = executeScriptOnTarget(
                  scriptBody,
                  buildTargetCommandContext(canonicalMachineId, tier),
                );
                await flushPendingPatches();
                return result;
              },
            );
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
          findMachineByIpAsync: findEffectiveMachineByIpAsync,
          getLocalIP,
          resolveDomain,
          resolveNat,
          findMachineUsers,
          getNodeFromMachine,
          getLocalNode: (path: string) => getNode(resolvePath(path)),
          getCurrentPath: () => session.currentPath,
          onBruteForceAggregate: onHydraBruteForceAggregate,
          getCanonicalWorkstationId: (targetIp: string): string | null => {
            const canonical = resolveTargetMachineId(targetIp);
            if (parseWorkstationId(canonical) === undefined) return null;
            if (isOwnWorkstation(canonical, hostname)) return null;
            return canonical;
          },
          onCrackCredentialsBatch: async (params) =>
            crackCredentials(
              getIdentity(),
              params.targetWorkstationId,
              params.service,
              params.candidateHashes,
              params.userFilter,
            ),
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
          findMachineByIpAsync: findEffectiveMachineByIpAsync,
          resolveDomain,
          resolveNat,
          getNodeFromMachine: (machineId, path, cwd) =>
            getNodeFromMachine(resolveTargetMachineId(machineId), path, cwd),
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
          resolveTargetMachineId,
          withTransientAuthSession: async (params, body) => {
            const result = await withTransientAuthSession(
              getIdentity(),
              {
                machine_id: params.machine_id,
                kind: 'snmp',
                username: 'snmp',
                auth: params.auth,
                ...(session.sessionId !== null && { parent_session_id: session.sessionId }),
                source_ip: session.machine,
              },
              async () => {
                body();
                await flushPendingPatches();
              },
            );
            return result.ok ? { ok: true } : { ok: false, reason: result.reason };
          },
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
        createMysqlCommand({
          getMachine,
          findMachineByIp,
          findMachineByIpAsync: findEffectiveMachineByIpAsync,
          getLocalIP,
          resolveDomain,
        }),
        isWifiRequired,
      ),
      isMachineBricked,
    ),
  );

  commands.set(
    'rediscli',
    wrapWithBrickedCheck(
      wrapWithWifiCheck(
        createRediscliCommand({
          getMachine,
          findMachineByIp,
          findMachineByIpAsync: findEffectiveMachineByIpAsync,
          getLocalIP,
          resolveDomain,
        }),
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
          findMachineByIpAsync: findEffectiveMachineByIpAsync,
          getLocalIP,
          getCurrentMachine: () => session.machine,
          getCurrentPath: () => session.currentPath,
          resolvePath: (path: string) => resolvePath(path),
          getNode: (path: string) => getNode(path),
          getNodeFromMachine: (machineId, path, cwd) =>
            getNodeFromMachine(resolveTargetMachineId(machineId), path, cwd),
          createFileOnMachine: (op) =>
            createFileOnMachine({ ...op, machineId: resolveTargetMachineId(op.machineId) }),
          resolveNat,
          withTransientAuthSession: (params, body) => {
            const canonical = resolveTargetMachineId(params.machine_id);
            return withTransientAuthSession(
              getIdentity(),
              {
                machine_id: canonical,
                kind: 'scp',
                username: params.username,
                auth: params.auth,
                ...(session.sessionId !== null && { parent_session_id: session.sessionId }),
                source_ip: session.machine,
              },
              async ({ userType }) => {
                await awaitCrossPlayerBaseFs(canonical, userType);
                body();
                await flushPendingPatches();
              },
            );
          },
        }),
        isWifiRequired,
      ),
      isMachineBricked,
    ),
  );

  const lynxFetch = buildLynxFetch({
    getMachine: getEffectiveMachine,
    findMachineByIpAsync: findEffectiveMachineByIpAsync,
    resolveDomain,
    resolveNat,
    readFileFromMachine: (op) =>
      readFileFromMachine({ ...op, machineId: resolveTargetMachineId(op.machineId) }),
    getHandler,
    onHttpRequest,
  });

  return { commands, lynxFetch };
};
