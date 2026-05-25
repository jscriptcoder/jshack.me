import { useMemo } from 'react';
import { useStableCallback } from './useStableCallback';
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

  // resolveTargetMachineId is built fresh every render from
  // buildResolveTargetMachineId. Stable-wrap so consumers (cross-LAN
  // command bodies) can capture it inside long-lived closures without
  // holding a stale impl. The context-method peers (resolveNat,
  // readFileFromMachine, etc.) are stable at their source hooks
  // (PR #165); this handles the locally-built sibling.
  const resolveTargetMachineId = useStableCallback(
    buildResolveTargetMachineId(
      activeNetwork,
      lanOccupants,
      hostname,
      foreignNetworks,
      foreignLanOccupants,
    ),
  );

  return useMemo(() => {
    // WiFi is required only when the player is sitting on their own
    // workstation and not connected to a network. Once SSH'd into a
    // remote, the network commands operate from the remote's perspective
    // and don't need a WiFi link from the workstation.
    const isWifiRequired = () => isOwnWorkstation(session.machine, hostname) && !wifiConnected;

    // resolveTargetMachineId is built at hook scope (above useMemo) so
    // both this useMemo body AND the resolveTargetMachineIdRef can use
    // it. Non-cross-LAN call sites in this body capture it directly;
    // cross-LAN command wrappers (curl/gobuster/lynx) read via the ref
    // so the OLD command closure picks up the LATEST translation after
    // an async pre-resolve materializes a new foreign network.

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
    // Async sibling — pre-resolves the target via the cross-LAN
    // seed-regen resolver before applying the version overlay. Commands
    // that take user-typed public IPs (nmap on a foreign router being
    // the bellwether) await this at entry so the foreign HomeNetwork
    // materializes before the rest of the command's sync resolution
    // logic runs.
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
            // Wrapper translates the post-NAT LAN IP to the canonical
            // workstation_id so B's hosted content is read from B's
            // storage. readFileFromMachine + resolveTargetMachineId are
            // both stable, so the captured closure stays correct.
            readFileFromMachine: (op) =>
              readFileFromMachine({
                ...op,
                machineId: resolveTargetMachineId(op.machineId),
              }),
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
      wrapWithBrickedCheck(
        wrapWithWifiCheck(createLynxCommand(), isWifiRequired),
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
            findMachineByIpAsync: findEffectiveMachineByIpAsync,
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
              // Translate IP-form machineId to canonical workstation_id for
              // cross-player LAN occupants. Without this, the session row
              // and patch land under the LAN IP key (e.g. 192.168.6.217)
              // instead of B's workstation_id (omen-XXXXXXXX); B's Realtime
              // subscription is on the workstation_id so the broadcast
              // never reaches B's tab. Mirrors exploitFileRead /
              // exploitDirList / logFs.writeFileToMachine. NPC / mission /
              // world / own-workstation IPs pass through unchanged.
              // Surfaced in smoke on file_write (msfconsole CVE).
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
            // Cross-player-aware file_read / dir_list. Translates the
            // supplied
            // ip-form machineId to canonical (workstation_id for LAN
            // occupants, unchanged for NPC / mission / world). Cross-player
            // workstation targets bounce through the server's exploitRead
            // endpoint inside an effect_one_shot transient session — the
            // server walks B's regenerated base FS at the CVE-granted
            // tier (read from the session row, not the envelope). Own-
            // workstation and NPC/mission/world targets stay local — A
            // already has the FS state needed to read at any tier.
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
              // Same IP→workstation_id translation as writeRemoteFile (above)
              // and exploitFileRead — scripts run against cross-player
              // workstations must key the transient session AND every write
              // the script performs by B's canonical workstation_id, not
              // the LAN IP. Otherwise patch broadcasts miss B's Realtime
              // subscription. file_write smoke surfaced the writeRemoteFile
              // bug; this branch has the same shape.
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
            // When the target IP resolves to another player's
            // workstation_id,
            // hydra routes through the server's batched crackCredentials
            // endpoint instead of the local /etc/passwd sweep (which
            // sees an empty FS pre-session for cross-player workstations).
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
            // Wrapper translates machineId to canonical for cross-LAN
            // occupants (post-NAT LAN IP → workstation_id).
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
            // Canonicalize gateway .1 aliases to the gateway's primary IP
            // so writes via either interface land in the same patches row
            // (and the L2 session keys by the same canonical id).
            resolveTargetMachineId,
            // Server-authoritative SNMP auth. Community string is
            // the credential; server validates rwcommunity match against
            // /etc/snmp/snmpd.conf and creates a session at userType='root'.
            // params.machine_id arrives canonicalized from snmpset.ts via
            // resolveTargetMachineId above.
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
            // Wrapper translates machineId to canonical for cross-LAN
            // occupants so scp's "is destination a directory?" probe
            // looks at B's storage (workstation_id), not B's LAN IP.
            getNodeFromMachine: (machineId, path, cwd) =>
              getNodeFromMachine(resolveTargetMachineId(machineId), path, cwd),
            // Wrapper translates machineId so the upsertPatch broadcasts
            // to B's workstation_id Realtime channel and the server-side
            // L1 validation sees the same key the transient session was
            // created with.
            createFileOnMachine: (op) =>
              createFileOnMachine({
                ...op,
                machineId: resolveTargetMachineId(op.machineId),
              }),
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
            withTransientAuthSession: (params, body) => {
              // Translate LAN IP → canonical machine_id so cross-player
              // SCP transfers land at B's workstation_id (where
              // /etc/passwd is stored), not B's LAN IP.
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
                  // For cross-player workstation targets, fetch B's
                  // base FS at the server-validated tier BEFORE running
                  // body — without it, body's createFileOnMachine bails
                  // with "Not a directory: /tmp" because A's view of B
                  // only has patches (no base directory tree). Awaiting
                  // the response (instead of fire-and-forget) is what
                  // distinguishes this from the persistent-session
                  // effect path in useFileSystemSync. No-op for own-
                  // workstation / NPC / mission targets (the helper
                  // short-circuits on non-workstation_id machine_ids).
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
        readFileFromMachine({
          ...op,
          machineId: resolveTargetMachineId(op.machineId),
        }),
      getHandler,
      onHttpRequest,
    });

    return { commands, lynxFetch };
    // Every method consumed here is stable-identity (PR #165 wraps the
    // context methods; resolveTargetMachineId is stable-wrapped above).
    // So the only deps that matter for invalidation are state VALUES.
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
    awaitCrossPlayerBaseFs,
    resolveTargetMachineId,
    session.machine,
    session.hostname,
    session.currentPath,
    session.username,
    session.userType,
    session.sessionId,
    hostname,
    // activeNetwork/lanOccupants/foreignNetworks/foreignLanOccupants are
    // intentionally omitted — they only feed resolveTargetMachineId
    // (stable-wrapped above), so changes to them don't require rebuilding
    // the commands map.
    wifiConnected,
    isMachineBricked,
    findMachineByIp,
    findMachineByIpAsync,
    getPublicIP,
    getHandler,
  ]);
};
