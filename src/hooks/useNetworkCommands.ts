import { useMemo } from 'react';
import { useNetwork } from '../network';
import { useFileSystem } from '../filesystem';
import { useSession } from '../session/SessionContext';
import { useHomeNetworks } from '../homeNetworks/HomeNetworksContext';
import { isOwnWorkstation, targetMachineIdFor } from '../homeNetworks/homeNetworkHelpers';
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
  } = useFileSystem();
  const { session, wifiConnected, isMachineBricked, hostname } = useSession();
  const { activeNetwork, lanOccupants } = useHomeNetworks();

  return useMemo(() => {
    // WiFi is required only when the player is sitting on their own
    // workstation and not connected to a network. Once SSH'd into a
    // remote, the network commands operate from the remote's perspective
    // and don't need a WiFi link from the workstation.
    const isWifiRequired = () => isOwnWorkstation(session.machine, hostname) && !wifiConnected;

    // Translate a target IP into the canonical machine_id storage key
    // before any patch/log write. For LAN occupants the IP-form
    // (e.g., 10.0.0.42) maps to the occupant's hostname (= their
    // workstation_id) so cross-player writes land where the target
    // player is subscribed via patches:<workstation_id>. For mission/
    // world/off-LAN IPs the input passes through unchanged.
    const activeSubnet = activeNetwork?.layers[0]?.subnet ?? null;
    const ownLanIp = activeNetwork?.localhostIp ?? null;
    const resolveTargetMachineId = (targetIp: string): string =>
      targetMachineIdFor(targetIp, lanOccupants, activeSubnet, ownLanIp, hostname);

    // logFs auto-translates the machineId on every read/write/create so
    // any log-writing handler (sshAuth, ftpAuth, hydraLog, etc.) that
    // hands an IP-form machineId routes the patch under the occupant's
    // workstation_id when applicable. Non-occupant IPs (mission, world,
    // off-LAN) pass through unchanged. Reads MUST go through the same
    // translation so writers and readers agree on the storage key.
    const logFs = {
      readFileFromMachine: (op: Parameters<typeof readFileFromMachine>[0]) =>
        readFileFromMachine({ ...op, machineId: resolveTargetMachineId(op.machineId) }),
      writeFileToMachine: (op: Parameters<typeof writeFileToMachine>[0]) =>
        writeFileToMachine({ ...op, machineId: resolveTargetMachineId(op.machineId) }),
      createFileOnMachine: (op: Parameters<typeof createFileOnMachine>[0]) =>
        createFileOnMachine({ ...op, machineId: resolveTargetMachineId(op.machineId) }),
    };

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
            getHandler,
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
      const mid: MachineId = machineId;
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
            // Whole-mission lookup so the post-NAT internal target is
            // reachable when the player is on localhost (where getMachine
            // would return undefined for LAN IPs).
            findMachineByIp: findEffectiveMachineByIp,
            getLocalIP,
            // NAT resolver: when player runs msfconsole publicIP forwardedPort,
            // msfconsole resolves to the actual internal target so all
            // effect-phase ops (writes, script-exec, gateway-chain lookup)
            // operate on the right machine instead of the public-IP router.
            // Identity passthrough for direct LAN-internal exploits.
            resolveNat,
            getCurrentMachineId: () => session.machine,
            // The player's own workstation isn't in the remote-machines
            // list (it's generated separately via generateLocalhost), so
            // we synthesize a minimal RemoteMachine for it on demand. The
            // dispatch only needs `users` to resolve shell-effect tiers.
            // session.machine === hostname when the player is sitting on
            // their own workstation under the eliminated-localhost model.
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
            // Wrap writeRemoteFile + runScriptOnTarget in transient
            // sessions (kind='effect_one_shot') so the L1 patch-validation
            // gate sees a session row at fire time. msfconsole's switch
            // cases await these callbacks (they were sync before; see
            // src/commands/msfconsole.ts MsfconsoleContext for the
            // signature change).
            //
            // The body awaits flushPendingPatches() before returning so
            // withTransientSession's `await body()` waits for in-flight
            // upsertPatch / removePatch network calls to settle. Without
            // this, the wrapping endSession can race the patch and
            // arrive at the server first — patch sees an ended session
            // and 403s on L1.
            // Returns the underlying upsertFileOnMachine result so callers
            // (msfconsole's file_write / password_reset / backdoor_port_open)
            // can surface failure instead of silently printing "Exploit
            // successful". Uses upsertFileOnMachine (vs writeFileToMachine)
            // so brand-new paths actually get a patch — file_write and
            // backdoor_port_open typically target paths that don't exist.
            writeRemoteFile: async (machineId, path, content, tier = 'root') => {
              let writeResult: { allowed: boolean; error?: string } = { allowed: false };
              await withTransientSession(
                getIdentity(),
                {
                  machine_id: machineId,
                  credentials: { username: 'msf', userType: tier },
                  kind: 'effect_one_shot',
                  ...(session.sessionId !== null && { parent_session_id: session.sessionId }),
                  source_ip: session.machine,
                },
                async () => {
                  writeResult = upsertFileOnMachine({
                    machineId,
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
                async () => {
                  const result = executeScriptOnTarget(
                    scriptBody,
                    buildTargetCommandContext(machineId, tier),
                  );
                  await flushPendingPatches();
                  return result;
                },
              ),
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
            // PR 4 — server-authoritative SNMP auth. Community string is
            // the credential; server validates rwcommunity match against
            // /etc/snmp/snmpd.conf and creates a session at userType='root'.
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
            //
            // The body awaits flushPendingPatches() before returning so
            // the wrapping endSession only fires after in-flight upserts
            // settle — otherwise endSession can race the patch and the
            // patch hits 403 no_session via the L1 gate.
            withTransientAuthSession: (params, body) =>
              withTransientAuthSession(
                getIdentity(),
                {
                  // Translate LAN IP → canonical machine_id so cross-
                  // player SCP transfers land at B's workstation_id
                  // (where /etc/passwd is stored), not B's LAN IP.
                  // Mirrors logFs's resolveTargetMachineId wrapping
                  // for write paths.
                  machine_id: resolveTargetMachineId(params.machine_id),
                  kind: 'scp',
                  username: params.username,
                  auth: params.auth,
                  ...(session.sessionId !== null && { parent_session_id: session.sessionId }),
                  source_ip: session.machine,
                },
                async () => {
                  body();
                  await flushPendingPatches();
                },
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
    upsertFileOnMachine,
    deleteNodeFromMachine,
    listDirectoryFromMachine,
    flushPendingPatches,
    session.machine,
    session.hostname,
    session.currentPath,
    session.username,
    session.userType,
    session.sessionId,
    hostname,
    activeNetwork,
    lanOccupants,
    wifiConnected,
    isMachineBricked,
    findMachineByIp,
    getPublicIP,
    getHandler,
  ]);
};
