import type {
  Command,
  AsyncOutput,
  NcPromptData,
  ExploitShellData,
} from '../components/Terminal/types';
import type { RemoteMachine, DnsRecord, Port, Vulnerability } from '../network/types';
import { findExploitableCve } from '../generation/findExploitableCve';
import { findLibraryCve } from '../generation/systemLibraryLookup';
import { pickCommandEffect } from '../generation/timeline/systemCommandEffects';
import { createPrng } from '../generation/prng';
import { parseDpkgVersions, DPKG_STATUS_PATH } from '../network/dpkgStatus';
import { libraryDeps } from './libraryDeps';
import { createCancellationToken, jitter } from '../utils/asyncCommand';
import { md5 } from '../utils/md5';
import { ncPidFilePath, createNcPidContent } from './nc';

export type ExploitAttemptInfo = {
  readonly targetIp: string;
  readonly port: number;
  readonly service?: string;
  readonly serviceVersion?: string;
  readonly success: boolean;
};

type MsfconsoleContext = {
  readonly getMachine: (ip: string) => RemoteMachine | undefined;
  readonly getLocalIP: () => string;
  // For `msfconsole --local <command>` — identifies the machine the player
  // is currently shelled into (session.machine). Undefined means the player
  // has no current-machine context (e.g., pre-shell state), and --local
  // will refuse to resolve.
  readonly getCurrentMachineId?: () => string;
  // Returns the current machine as a RemoteMachine. Handles the localhost
  // case, which isn't in the regular remote-machines list (localhost is the
  // player's workstation, generated separately via generateLocalhost).
  // Used by --local to resolve the user set for shell-effect tiers.
  readonly getCurrentMachine?: () => RemoteMachine | undefined;
  readonly resolveDomain: (domain: string) => DnsRecord | undefined;
  readonly getGameTime?: () => number;
  readonly onExploitAttempt?: (info: ExploitAttemptInfo) => void;
  readonly readRemoteFile?: (
    machineId: string,
    path: string,
    tier?: 'guest' | 'user' | 'root',
  ) => string | null;
  readonly readLocalFile?: (path: string) => string | null;
  // Cross-player-aware file_read / dir_list path. On cross-player
  // workstation targets the wiring layer wraps the call in
  // withTransientSession (kind=
  // 'effect_one_shot') and dispatches to the server's exploitRead
  // endpoint, which walks B's regenerated base FS at the CVE-granted
  // tier. On NPC machines and own-workstation targets it falls back to
  // the local readFileFromMachine / listDirectoryFromMachine path
  // (no server roundtrip needed — A regenerates the same FS as B for
  // NPC home/world/mission machines, and own-workstation has full local
  // state). msfconsole's file_read and dir_list switch cases use these
  // exclusively; the sync `readRemoteFile` above is reserved for non-
  // CVE consumers (--local dpkg parse, password_reset /etc/passwd read)
  // whose cross-player handling falls outside this PR's scope.
  readonly exploitFileRead?: (
    machineId: string,
    path: string,
    tier: 'guest' | 'user' | 'root',
  ) => Promise<string | null>;
  readonly exploitDirList?: (
    machineId: string,
    path: string,
    tier: 'guest' | 'user' | 'root',
  ) => Promise<readonly string[] | null>;
  // writeRemoteFile and runScriptOnTarget are async because the wiring
  // layer wraps them in a transient server session (kind='effect_one_shot')
  // for the L1 patch-validation gate. Tests that don't supply these
  // callbacks see no behavioral change; tests that do must return
  // promises. The switch cases below `await` them.
  // Returns { allowed: true } on success, { allowed: false, error } when the
  // underlying write was rejected (permission denied, parent dir missing,
  // etc.). Callers MUST surface `error` instead of unconditionally printing
  // "Exploit successful" — silently swallowing failure is how the file_write
  // and backdoor_port_open effects pretended to work without firing patches.
  readonly writeRemoteFile?: (
    machineId: string,
    path: string,
    content: string,
    tier?: 'guest' | 'user' | 'root',
  ) => Promise<{ readonly allowed: boolean; readonly error?: string }>;
  readonly listRemoteDir?: (
    machineId: string,
    path: string,
    tier?: 'guest' | 'user' | 'root',
  ) => readonly string[] | null;
  readonly runScriptOnTarget?: (
    machineId: string,
    scriptBody: string,
    tier: 'guest' | 'user' | 'root',
  ) => Promise<{ readonly error: string | null }>;
  // Resolves a (host, port) pair through any NAT-forwarding rule on the
  // network. When the player runs `msfconsole publicIP forwardedPort`,
  // this returns the actual internal target (ip + port). Without it,
  // effects would fire against the public-IP router's filesystem instead
  // of the internal target. Optional for tests; defaults to identity
  // (the LAN-internal-IP case is unaffected).
  readonly resolveNat?: (
    ip: string,
    port: number,
  ) => { readonly ip: string; readonly port: number };
  // Whole-mission machine lookup, regardless of the player's current view.
  // After NAT resolution the internal target may not be visible via
  // `getMachine` — that returns machines reachable from session.machine,
  // which excludes the LAN when player is on localhost. Without this
  // fallback the post-NAT effectiveMachine ends up as the router and
  // tier-user lookups pick router users that don't exist on the actual
  // target. Optional for tests; falls back to getMachine when not provided.
  readonly findMachineByIp?: (ip: string) => RemoteMachine | undefined;
};

const MSFCONSOLE_PHASE_DELAY_MS = 600;

export const createMsfconsoleCommand = (context: MsfconsoleContext): Command => ({
  name: 'msfconsole',
  category: 'network',
  description: 'Exploit a vulnerable service for remote code execution',
  manual: {
    synopsis: 'msfconsole <host> <port>',
    description:
      'Exploit a known vulnerability on a remote service to gain shell access. ' +
      'Use nmap -sV <target> first to discover vulnerable services and their CVEs. ' +
      'Only works against ports with known vulnerabilities.',
    arguments: [
      { name: 'host', description: 'IP address or hostname of the target machine', required: true },
      { name: 'port', description: 'Port number of the vulnerable service', required: true },
    ],
    examples: [
      {
        command: 'msfconsole 10.50.100.10 80',
        description: 'Exploit a vulnerable HTTP service',
      },
      {
        command: 'msfconsole web01.mission 3306',
        description: 'Exploit a vulnerable MySQL service',
      },
    ],
  },
  fn: (...args: unknown[]): AsyncOutput => {
    // --- Branch: `msfconsole --local <command> [thirdArg]` ---
    // Resolves a library CVE against the current machine's /lib/*.so
    // versions instead of a remote port. Rolls an effect from the command's
    // own pool and falls through to the shared effect-dispatch below.
    if (args[0] === '--local') {
      return runLocalExploit(args, context);
    }

    // --- Branch: regular remote exploit (msfconsole <host> <port>) ---
    const { getMachine, getLocalIP, resolveDomain, onExploitAttempt } = context;

    const host = args[0] as string | undefined;
    const portArg = args[1];
    const port = portArg === undefined ? undefined : Number(portArg);
    const thirdArg = args[2] as string | undefined;

    if (!host) {
      throw new Error(
        'msfconsole: missing host\nUsage: msfconsole <host> <port> [path-or-local:remote]',
      );
    }

    if (port === undefined || Number.isNaN(port)) {
      throw new Error(
        'msfconsole: missing or invalid port\nUsage: msfconsole <host> <port> [path-or-local:remote]',
      );
    }

    if (port < 1 || port > 65535) {
      throw new Error('msfconsole: port must be between 1 and 65535');
    }

    let targetIP = host;
    if (!host.match(/^\d+\.\d+\.\d+\.\d+$/)) {
      const record = resolveDomain(host);
      if (!record) {
        throw new Error(`msfconsole: ${host}: Name or service not known`);
      }
      targetIP = record.ip;
    }

    const localIP = getLocalIP();
    if (targetIP === localIP || targetIP === '127.0.0.1' || host === 'localhost') {
      throw new Error('msfconsole: cannot exploit localhost');
    }

    const machine = getMachine(targetIP);
    if (!machine) {
      throw new Error(`msfconsole: connect to ${targetIP}: Connection timed out`);
    }

    const targetPort = machine.ports.find((p) => p.port === port);
    if (!targetPort || !targetPort.open) {
      onExploitAttempt?.({ targetIp: targetIP, port, success: false });
      throw new Error(`msfconsole: ${targetIP}:${port}: Connection refused`);
    }

    const gameTime = context.getGameTime?.() ?? 0;
    const vulnerability = findExploitableCve(machine, targetPort, gameTime);
    if (!vulnerability) {
      onExploitAttempt?.({
        targetIp: targetIP,
        port,
        service: targetPort.service,
        serviceVersion: targetPort.serviceVersion,
        success: false,
      });
      throw new Error(`msfconsole: no known vulnerability on ${targetIP}:${port}`);
    }

    if (!targetPort.owner) {
      onExploitAttempt?.({
        targetIp: targetIP,
        port,
        service: targetPort.service,
        serviceVersion: targetPort.serviceVersion,
        success: false,
      });
      throw new Error(`msfconsole: exploit failed — service not exploitable`);
    }

    // NAT resolution: when the player ran `msfconsole publicIP forwardedPort`,
    // resolve to the actual internal target so effects mutate the right
    // machine. For LAN-internal IPs (no NAT rule), resolveNat returns the
    // input unchanged, so behavior here is invariant for direct exploits.
    // The CVE detection above used the merged router port's metadata
    // (which inherited from the internal port via networkUtils), so we only
    // diverge from the public-IP machine for the EFFECT phase below.
    const resolved = context.resolveNat?.(targetIP, port) ?? { ip: targetIP, port };
    const effectiveIp = resolved.ip;
    // findMachineByIp searches the whole mission so the internal target
    // is reachable even when the player is on localhost (where getMachine
    // would return undefined for the LAN's IPs). Falls back to getMachine
    // for tests that don't supply findMachineByIp; ultimately to `machine`
    // (the router-with-merged) as a safety net.
    const effectiveMachine =
      context.findMachineByIp?.(effectiveIp) ?? getMachine(effectiveIp) ?? machine;

    onExploitAttempt?.({
      targetIp: targetIP,
      port,
      service: targetPort.service,
      serviceVersion: targetPort.serviceVersion,
      success: true,
    });

    return buildExploitOutput(
      {
        machine,
        targetIP,
        effectiveIp,
        effectiveMachine,
        port,
        targetPort,
        vulnerability,
      },
      thirdArg,
      context,
    );
  },
});

// Shared dispatch: given a resolved exploit target + rolled vulnerability,
// returns the AsyncOutput that drives the exploit UI (payload phases,
// effect application, final shell/data delivery). Used by both the remote
// host/port path and the --local library-CVE path.
//
// `targetIP` / `machine` are the player-input view (public IP, possibly
// router-with-merged-ports). `effectiveIp` / `effectiveMachine` are the
// NAT-resolved actual target — equal to the player view for direct
// LAN-internal exploits, or the internal target for NAT-forwarded ones.
// Use `targetIP` / `machine` for player-facing log lines; use the
// `effective*` for any read/write/script-exec that mutates real state.
type ExploitTarget = {
  readonly machine: RemoteMachine;
  readonly targetIP: string;
  readonly effectiveIp: string;
  readonly effectiveMachine: RemoteMachine;
  readonly port: number;
  readonly targetPort: Port;
  readonly vulnerability: Vulnerability;
};

// Local exploit resolver: the player has a shell on a machine and wants to
// exploit a system library CVE via one of the pre-installed commands in
// that command's libraryDeps manifest. The vulnerability is in the
// library; the effect is rolled from the command's pool (e.g., libpcre CVE
// via `ls` lands `dir_list`; via `grep` lands `file_read`).
//
// Shape:
//   msfconsole --local <command> [thirdArg]
//
// Success = library CVE found + effect rolled + buildExploitOutput returned.
// Failure = no libraryDeps entry, no current machine, no library CVE live —
// all surface as "no known vulnerability on <command>" (parallel wording to
// the remote path so the player learns one error message).
const runLocalExploit = (args: readonly unknown[], context: MsfconsoleContext): AsyncOutput => {
  const commandName = args[1] as string | undefined;
  const thirdArg = args[2] as string | undefined;

  if (!commandName) {
    throw new Error(
      'msfconsole: --local requires a command name\nUsage: msfconsole --local <command> [thirdArg]',
    );
  }

  const deps = libraryDeps[commandName];
  if (!deps || deps.length === 0) {
    throw new Error(`msfconsole: no known vulnerability on ${commandName}`);
  }

  const currentMachineId = context.getCurrentMachineId?.();
  if (!currentMachineId) {
    throw new Error('msfconsole --local: no current machine context');
  }

  // Prefer getCurrentMachine (handles localhost) over getMachine (which
  // only knows remote machines). Fall back to getMachine for older contexts
  // that don't provide getCurrentMachine.
  const machine = context.getCurrentMachine?.() ?? context.getMachine(currentMachineId);
  if (!machine) {
    throw new Error(`msfconsole --local: cannot resolve current machine ${currentMachineId}`);
  }

  const gameTime = context.getGameTime?.() ?? 0;

  // Read the machine's dpkg/status to find which library versions are
  // currently installed. Uniform day-zero versions + any apt upgrade
  // history are both reflected here.
  const dpkgContent = context.readRemoteFile?.(currentMachineId, DPKG_STATUS_PATH) ?? '';
  const libraryVersions = parseDpkgVersions(dpkgContent);

  // Walk the command's linked libraries and return the first with a live
  // CVE. Manifest order is stable, so selection is deterministic.
  const libraryCve = deps
    .map((lib) => {
      const version = libraryVersions.get(lib);
      if (!version) return undefined;
      return findLibraryCve(lib, version, gameTime);
    })
    .find((v): v is Vulnerability => v !== undefined);

  if (!libraryCve) {
    throw new Error(`msfconsole: no known vulnerability on ${commandName}`);
  }

  // Roll an effect from the command's own pool. PRNG seed binds
  // (machine, command, cve) so the same local exploit always lands the
  // same effect — deterministic like every other CVE in the game.
  const effectPrng = createPrng(
    `local-exploit:${currentMachineId}:${commandName}:${libraryCve.cve}`,
  );
  const rolledEffect = pickCommandEffect(commandName, effectPrng);
  if (!rolledEffect) {
    throw new Error(`msfconsole: no known vulnerability on ${commandName}`);
  }

  // Override the library CVE's placeholder effect with the command-scoped
  // rolled one. This is the "library carries the CVE, command carries the
  // exploitation semantics" split.
  const vulnerability: Vulnerability = { ...libraryCve, effect: rolledEffect };

  // Synthesize a target context. For local exploits there is no port; we
  // use port 0 + the command name as "service" so existing output lines
  // read sensibly (`[*] Targeting 10.50.1.5:0 (libpam 1.5.3)` etc.).
  const syntheticTargetPort: Port = {
    port: 0,
    service: commandName,
    open: true,
    serviceVersion: libraryCve.serviceVersion,
  };

  return buildExploitOutput(
    {
      machine,
      targetIP: currentMachineId,
      // --local exploits run on the current machine — no NAT translation
      // applies. effective* fields equal the player-input view.
      effectiveIp: currentMachineId,
      effectiveMachine: machine,
      port: 0,
      targetPort: syntheticTargetPort,
      vulnerability,
    },
    thirdArg,
    context,
  );
};

const buildExploitOutput = (
  target: ExploitTarget,
  thirdArg: string | undefined,
  context: MsfconsoleContext,
): AsyncOutput => {
  const { targetIP, effectiveIp, effectiveMachine, port, targetPort, vulnerability } = target;
  const { effect } = vulnerability;

  const requiresPath = effect.kind === 'file_read' || effect.kind === 'dir_list';
  const requiresLocalRemote = effect.kind === 'file_write';
  const requiresScript = effect.kind === 'script_exec';

  if ((requiresPath || requiresScript) && !thirdArg) {
    throw new Error(
      `msfconsole: this exploit requires a target path — usage: msfconsole <host> <port> <path>`,
    );
  }
  if (requiresLocalRemote && (!thirdArg || !thirdArg.includes(':'))) {
    throw new Error(
      `msfconsole: this exploit requires local:remote syntax — usage: msfconsole <host> <port> <local:remote>`,
    );
  }

  const token = createCancellationToken();

  // For shell_full, the tier comes from the effect, not the port owner.
  // Resolve a plausible username and home path for the effect's tier.
  const resolveShellFullUser = (
    tier: 'guest' | 'user' | 'root',
  ): { readonly username: string; readonly homePath: string } => {
    if (tier === 'root') return { username: 'root', homePath: '/root' };
    // shell_full lands on the actual target machine — match its user list
    // (effectiveMachine), not the public-IP router-with-merged users.
    const matchingUser = effectiveMachine.users.find((u) => u.userType === tier);
    if (matchingUser) {
      return { username: matchingUser.username, homePath: `/home/${matchingUser.username}` };
    }
    return { username: tier, homePath: `/home/${tier}` };
  };

  return {
    __type: 'async',
    start: (onLine, onComplete) => {
      onLine(`[*] Targeting ${targetIP}:${port} (${vulnerability.serviceVersion})`);

      let delay = jitter(MSFCONSOLE_PHASE_DELAY_MS);

      token.schedule(() => {
        if (token.isCancelled()) return;
        onLine(`[*] Vulnerability: ${vulnerability.cve}`);
      }, delay);

      delay += jitter(MSFCONSOLE_PHASE_DELAY_MS);
      token.schedule(() => {
        if (token.isCancelled()) return;
        onLine('[*] Sending exploit payload...');
      }, delay);

      delay += jitter(MSFCONSOLE_PHASE_DELAY_MS);
      token.schedule(() => {
        if (token.isCancelled()) return;
        onLine('[*] Payload delivered, waiting for callback...');
      }, delay);

      delay += jitter(MSFCONSOLE_PHASE_DELAY_MS);
      token.schedule(() => {
        if (token.isCancelled()) return;
        // Async IIFE so the case bodies that await writeRemoteFile /
        // runScriptOnTarget (wrapped in transient sessions for the L1
        // patch-validation gate) don't block the schedule callback's
        // sync return. The void marker keeps no-floating-promises happy.
        void (async () => {
          switch (effect.kind) {
            case 'shell_full': {
              const shellUser = resolveShellFullUser(effect.tier);
              onLine('[+] Exploit successful!');
              onLine(`[+] Full shell as ${shellUser.username}@${targetIP}`);
              onLine('');
              const exploitShell: ExploitShellData = {
                __type: 'exploit_shell',
                // Shell lands on the actual target machine; the public-IP
                // alias was only for the connection grammar.
                targetIP: effectiveIp,
                targetPort: port,
                service: targetPort.service,
                username: shellUser.username,
                userType: effect.tier,
                homePath: shellUser.homePath,
                tier: effect.tier,
              };
              onComplete(exploitShell);
              break;
            }
            case 'file_read': {
              const content =
                (await context.exploitFileRead?.(effectiveIp, thirdArg!, effect.tier)) ?? null;
              onLine('[+] Exploit successful!');
              if (content !== null) {
                onLine(`[+] Reading ${thirdArg} (as ${effect.tier}):`);
                onLine('');
                content.split('\n').forEach((line) => onLine(line));
              } else {
                onLine(`[-] File not found or permission denied (as ${effect.tier}): ${thirdArg}`);
              }
              onComplete();
              break;
            }
            case 'dir_list': {
              const entries =
                (await context.exploitDirList?.(effectiveIp, thirdArg!, effect.tier)) ?? null;
              onLine('[+] Exploit successful!');
              if (entries !== null) {
                onLine(`[+] Listing ${thirdArg} (as ${effect.tier}):`);
                onLine('');
                entries.forEach((entry) => onLine(entry));
              } else {
                onLine(
                  `[-] Directory not found or permission denied (as ${effect.tier}): ${thirdArg}`,
                );
              }
              onComplete();
              break;
            }
            case 'file_write': {
              const colonIdx = thirdArg!.indexOf(':');
              const localPath = thirdArg!.slice(0, colonIdx);
              const remotePath = thirdArg!.slice(colonIdx + 1);
              const localContent = context.readLocalFile?.(localPath) ?? null;
              if (localContent === null) {
                onLine(`[-] Could not read local file: ${localPath}`);
              } else {
                const writeResult = await context.writeRemoteFile?.(
                  effectiveIp,
                  remotePath,
                  localContent,
                  effect.tier,
                );
                if (writeResult && !writeResult.allowed) {
                  onLine(`[-] Exploit failed: ${writeResult.error ?? 'remote write rejected'}`);
                } else {
                  onLine('[+] Exploit successful!');
                  onLine(
                    `[+] Uploaded ${localPath} → ${remotePath} as ${effect.tier} (${localContent.length} bytes)`,
                  );
                }
              }
              onComplete();
              break;
            }
            case 'password_reset': {
              const tier = effect.tier;
              const newPassword = `pwned-${vulnerability.cve.slice(-4)}-${tier}`;
              // Read /etc/passwd from the resolved internal target so the
              // tier-matching user lookup picks a username that actually
              // exists on that machine — the public-IP router may share
              // none of the same users.
              const currentPasswd = context.readRemoteFile?.(effectiveIp, '/etc/passwd') ?? '';
              const targetUser =
                tier === 'root'
                  ? 'root'
                  : (effectiveMachine.users.find((u) => u.userType === tier)?.username ?? tier);
              // /etc/passwd stores md5 hashes — the player's typed password
              // is md5'd by the auth code and compared against this column.
              // Storing plaintext here would break subsequent auth even though
              // the message below tells the player the correct value to type.
              const newPasswordHash = md5(newPassword);
              const updatedPasswd = currentPasswd
                .split('\n')
                .map((line) => {
                  const parts = line.split(':');
                  if (parts[0] === targetUser) {
                    return [parts[0], newPasswordHash, ...parts.slice(2)].join(':');
                  }
                  return line;
                })
                .join('\n');
              const passwdResult = await context.writeRemoteFile?.(
                effectiveIp,
                '/etc/passwd',
                updatedPasswd,
              );
              if (passwdResult && !passwdResult.allowed) {
                onLine(`[-] Exploit failed: ${passwdResult.error ?? 'remote write rejected'}`);
              } else {
                onLine('[+] Exploit successful!');
                onLine(`[+] Password reset for '${targetUser}' — new password: ${newPassword}`);
              }
              onComplete();
              break;
            }
            case 'backdoor_port_open': {
              const backdoorPort = effect.port;
              const pidPath = ncPidFilePath(backdoorPort);
              const pidContent = createNcPidContent(backdoorPort, 'backdoor', effect.tier);
              const pidResult = await context.writeRemoteFile?.(
                effectiveIp,
                pidPath,
                pidContent,
                'root',
              );
              if (pidResult && !pidResult.allowed) {
                onLine(`[-] Exploit failed: ${pidResult.error ?? 'remote write rejected'}`);
                onComplete();
                break;
              }
              onLine('[+] Exploit successful!');
              onLine(`[+] Backdoor planted on port ${backdoorPort}`);
              onComplete();
              break;
            }
            case 'script_exec': {
              const scriptBody = context.readLocalFile?.(thirdArg!) ?? null;
              if (scriptBody === null) {
                onLine(`[-] Could not open script file: ${thirdArg}`);
                onComplete();
                break;
              }
              // Blind injection — execute script for side effects only, no output
              const scriptResult = (await context.runScriptOnTarget?.(
                effectiveIp,
                scriptBody,
                effect.tier,
              )) ?? {
                error: null,
              };
              if (scriptResult.error) {
                onLine(`[-] Script injection failed: ${scriptResult.error}`);
              } else {
                onLine('[+] Exploit successful!');
                onLine(`[+] Script injected on ${targetIP} as ${effect.tier}`);
              }
              onComplete();
              break;
            }
            case 'shell_limited': {
              // Use the effect's tier (not the port owner's) so nmap's "as X"
              // hint matches the actual privilege level the player lands at.
              const shellUser = resolveShellFullUser(effect.tier);
              onLine('[+] Exploit successful!');
              onLine(`[+] Got shell as ${shellUser.username}@${targetIP}`);
              onLine('');
              const ncPrompt: NcPromptData = {
                __type: 'nc_prompt',
                // Shell lands on the actual target, not the public-IP alias.
                targetIP: effectiveIp,
                targetPort: port,
                service: targetPort.service,
                username: shellUser.username,
                userType: effect.tier,
                homePath: shellUser.homePath,
                // proof: 'effect' — CVE-yielded shell. No pidfile to read;
                // tier comes from the effect (envelope-trusted today;
                // forge-bypass closure deferred).
                proof: 'effect',
              };
              onComplete(ncPrompt);
              break;
            }
          }
        })();
      }, delay);
    },
    cancel: token.cancel,
  };
};
