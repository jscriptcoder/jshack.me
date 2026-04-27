import type { Command, AsyncOutput, ScpPromptData } from '../components/Terminal/types';
import type { FileNode, MachineCreateOp, PermissionResult } from '../filesystem/types';
import type { RemoteMachine } from '../network/types';
import type { Credentials } from '../sessionRegistry/types';
import { createCancellationToken, jitter } from '../utils/asyncCommand';

// Transient-session wrapper: pushes a server session row, runs the
// body, ends the session. Required post-Step-1 because scp's write
// to the remote machine (via createFileOnMachine) creates a patch
// that the L1 patch-validation gate rejects (403) without an active
// session for the player on that machine. Optional to keep existing
// tests that don't care about session pushing — production callers
// in useNetworkCommands MUST supply it.
export type ScpTransientSession = (
  params: { readonly machine_id: string; readonly credentials: Credentials },
  body: () => void,
) => Promise<void>;

type ScpContext = {
  readonly getMachine: (ip: string) => RemoteMachine | undefined;
  readonly getLocalIP: () => string;
  readonly getCurrentMachine: () => string;
  readonly getCurrentPath: () => string;
  readonly resolvePath: (path: string) => string;
  readonly getNode: (path: string) => FileNode | null;
  readonly getNodeFromMachine: (machineId: string, path: string, cwd: string) => FileNode | null;
  readonly createFileOnMachine: (op: MachineCreateOp) => PermissionResult;
  readonly resolveNat: (ip: string, port: number) => { readonly ip: string; readonly port: number };
  readonly withTransientSession?: ScpTransientSession;
};

// Parses "user@host:path" into components
const parseDestination = (
  dest: string,
): { readonly user: string; readonly host: string; readonly path: string } | null => {
  const match = /^([^@]+)@([^:]+):(.+)$/.exec(dest);
  if (!match) return null;
  const [, user, host, path] = match;
  if (!user || !host || !path) return null;
  return { user, host, path };
};

export const createScpCommand = (context: ScpContext): Command => ({
  name: 'scp',
  category: 'network',
  description: 'Secure copy files between machines',
  manual: {
    synopsis: 'scp <source> <destination> [port] [password]',
    description:
      'Copy a file from the current machine to a remote machine via SSH. ' +
      'The destination uses user@host:path format. Preserves file permissions from the source. ' +
      'Requires an open SSH port on the target machine. ' +
      'An optional port argument overrides the SSH port (default: auto-detect). ' +
      'With a password, authentication happens automatically — useful in scripts via node.',
    arguments: [
      { name: 'source', description: 'Path to the file on the current machine', required: true },
      {
        name: 'destination',
        description: 'Remote destination in user@host:path format',
        required: true,
      },
      {
        name: 'port',
        description: 'SSH port to connect on (default: auto-detect)',
        required: false,
      },
      {
        name: 'password',
        description: 'Optional password for programmatic authentication',
        required: false,
      },
    ],
    examples: [
      {
        command: 'scp /usr/bin/nmap guest@192.168.1.50:/home/guest/nmap',
        description: 'Copy nmap binary to remote machine',
      },
      {
        command: 'scp /usr/bin/node guest@185.13.117.85:/home/guest 25',
        description: 'Copy via forwarded SSH port',
      },
      {
        command: 'scp /usr/bin/nmap guest@192.168.1.50:/home/guest secret',
        description: 'Copy with password (scripting)',
      },
    ],
  },
  fn: (...args: unknown[]): AsyncOutput => {
    const {
      getMachine,
      getLocalIP,
      getCurrentMachine,
      resolvePath,
      getNode,
      createFileOnMachine,
      resolveNat,
    } = context;

    if (args.length < 2 || typeof args[0] !== 'string' || typeof args[1] !== 'string') {
      throw new Error('scp: missing operand\nUsage: scp <source> <user@host:path> [port]');
    }

    const sourcePath = args[0];
    const destStr = args[1];

    // Overloaded args: scp(src, dst, password?) or scp(src, dst, port, password?)
    const thirdArg = args[2];
    const fourthArg = args[3];

    const dest = parseDestination(destStr);
    if (!dest) {
      throw new Error(
        `scp: invalid destination format: '${destStr}'\nUsage: scp <source> <user@host:path>`,
      );
    }

    const localIP = getLocalIP();
    if (dest.host === localIP || dest.host === '127.0.0.1' || dest.host === 'localhost') {
      throw new Error('scp: cannot copy to localhost — use cp instead');
    }

    // Validate source file
    const resolvedSource = resolvePath(sourcePath);
    const sourceNode = getNode(resolvedSource);
    if (!sourceNode) {
      throw new Error(`scp: ${sourcePath}: No such file or directory`);
    }
    if (sourceNode.type !== 'file') {
      throw new Error(`scp: ${sourcePath}: Is a directory`);
    }

    // Parse optional port argument; when omitted, auto-detect SSH service.
    // Script callers may pass a number (strict validation); shell callers pass
    // strings and we interpret port-shaped integers as ports.
    let explicitPort: number | undefined;
    let password: string | undefined;

    if (typeof thirdArg === 'number') {
      if (!Number.isInteger(thirdArg) || thirdArg < 1 || thirdArg > 65535) {
        throw new Error(`scp: invalid port '${String(thirdArg)}'`);
      }
      explicitPort = thirdArg;
      password = typeof fourthArg === 'string' ? fourthArg : undefined;
    } else if (typeof thirdArg === 'string') {
      const asNum = Number(thirdArg);
      const looksLikePort =
        thirdArg.trim() !== '' && Number.isInteger(asNum) && asNum >= 1 && asNum <= 65535;
      if (looksLikePort) {
        explicitPort = asNum;
        password = typeof fourthArg === 'string' ? fourthArg : undefined;
      } else {
        password = thirdArg;
      }
    }

    // Validate remote machine SSH access
    const machine = getMachine(dest.host);
    if (!machine) {
      throw new Error(
        `scp: connect to host ${dest.host} port ${explicitPort ?? 22}: Connection refused`,
      );
    }

    let port: number;
    if (explicitPort !== undefined) {
      // Explicit port: validate it's open (may be a forwarded port, not necessarily 'ssh')
      const targetPort = machine.ports.find((p) => p.port === explicitPort);
      if (!targetPort || !targetPort.open) {
        throw new Error(
          `scp: connect to host ${dest.host} port ${explicitPort}: Connection refused`,
        );
      }
      port = explicitPort;
    } else {
      // Auto-detect: find the first open SSH service port
      const sshPort = machine.ports.find((p) => p.service === 'ssh' && p.open);
      if (!sshPort) {
        throw new Error(`scp: connect to host ${dest.host} port 22: Connection refused`);
      }
      port = sshPort.port;
    }

    // Validate remote user exists
    const remoteUser = machine.users.find((u) => u.username === dest.user);
    if (!remoteUser) {
      throw new Error(`scp: ${dest.user}@${dest.host}: Permission denied (publickey)`);
    }

    // NAT resolution: in forwarded mode, the public router IP maps to the
    // internal entry machine. Filesystem operations use the resolved IP.
    const resolvedHost = resolveNat(dest.host, port).ip;

    // If destination is a directory, append source filename
    const remoteNode = context.getNodeFromMachine(resolvedHost, dest.path, '/');
    const destPath =
      remoteNode?.type === 'directory'
        ? `${dest.path.replace(/\/$/, '')}/${sourceNode.name}`
        : dest.path;

    // Read source content
    const content = sourceNode.content ?? '';
    const currentMachine = getCurrentMachine();
    const fileName = destPath.split('/').pop() ?? destPath;
    const bytes = content.length;

    const PROGRESS_STEP_MS = 350;

    // Returns an async transfer animation — called after password validation
    const performTransfer = (): AsyncOutput => {
      const transferToken = createCancellationToken();

      return {
        __type: 'async',
        start: (onLine, onComplete) => {
          let delay = 0;

          const steps = [0, 25, 50, 75, 100];
          steps.forEach((pct) => {
            delay += jitter(PROGRESS_STEP_MS);
            transferToken.schedule(() => {
              if (transferToken.isCancelled()) return;
              const transferred = Math.floor((bytes * pct) / 100);
              const bar = '#'.repeat(Math.floor(pct / 5)).padEnd(20, ' ');
              onLine(`${fileName}  ${pct}% [${bar}]  ${transferred}/${bytes} bytes`);
            }, delay);
          });

          // Actual transfer + summary
          delay += jitter(PROGRESS_STEP_MS);
          transferToken.schedule(() => {
            if (transferToken.isCancelled()) return;

            // Run the createFileOnMachine + summary inside a transient
            // session so the L1 gate sees a session row at fire time.
            // If the context didn't supply withTransientSession (some
            // tests), fall back to direct call — the gate may 403 in
            // that path but tests with mocked filesystem don't care.
            const doTransfer = () => {
              const result = createFileOnMachine({
                machineId: resolvedHost,
                path: destPath,
                cwd: '/',
                content,
                userType: remoteUser.userType,
                permissions: sourceNode.permissions,
              });

              if (!result.allowed) {
                onLine(`scp: ${destPath}: ${result.error}`);
              } else {
                onLine(`${fileName}  ${bytes} bytes  ${currentMachine} → ${dest.host}`);
              }
            };

            if (context.withTransientSession) {
              void context
                .withTransientSession(
                  {
                    machine_id: resolvedHost,
                    credentials: { username: dest.user, userType: remoteUser.userType },
                  },
                  doTransfer,
                )
                .catch((error) => {
                  console.error('[scp] transient session push failed:', error);
                  onLine(`scp: ${destPath}: session error`);
                })
                .finally(() => {
                  onComplete();
                });
            } else {
              doTransfer();
              onComplete();
            }
          }, delay);
        },
        cancel: transferToken.cancel,
      };
    };

    const token = createCancellationToken();
    const CONNECT_MS = 800;
    const HANDSHAKE_MS = 600;

    return {
      __type: 'async',
      start: (onLine, onComplete) => {
        onLine(`Connecting to ${dest.host}...`);

        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine('SSH-2.0-OpenSSH_8.9');

          token.schedule(() => {
            if (token.isCancelled()) return;
            onLine(`Authenticating as ${dest.user}...`);

            const scpPrompt: ScpPromptData = {
              __type: 'scp_prompt',
              targetUser: dest.user,
              targetIP: dest.host,
              targetPort: port,
              performTransfer,
              ...(password !== undefined && { password }),
            };

            onComplete(scpPrompt);
          }, jitter(HANDSHAKE_MS));
        }, jitter(CONNECT_MS));
      },
      cancel: token.cancel,
    };
  },
});
