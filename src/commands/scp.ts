import type { Command, AsyncOutput, ScpPromptData } from '../components/Terminal/types';
import type { FileNode, FilePermissions, PermissionResult } from '../filesystem/types';
import type { UserType } from '../session/SessionContext';
import type { RemoteMachine } from '../network/types';
import { createCancellationToken, jitter } from '../utils/asyncCommand';

type ScpContext = {
  readonly getMachine: (ip: string) => RemoteMachine | undefined;
  readonly getLocalIP: () => string;
  readonly getCurrentMachine: () => string;
  readonly getCurrentPath: () => string;
  readonly resolvePath: (path: string) => string;
  readonly getNode: (path: string) => FileNode | null;
  readonly getNodeFromMachine: (machineId: string, path: string, cwd: string) => FileNode | null;
  readonly createFileOnMachine: (
    machineId: string,
    path: string,
    cwd: string,
    content: string,
    userType: UserType,
    permissions?: FilePermissions,
  ) => PermissionResult;
  readonly resolveNat: (ip: string, port: number) => { readonly ip: string; readonly port: number };
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
    synopsis: 'scp(source, destination[, port][, password])',
    description:
      'Copy a file from the current machine to a remote machine via SSH. ' +
      'The destination uses user@host:path format. Preserves file permissions from the source. ' +
      'Requires an open SSH port on the target machine. ' +
      'An optional port argument overrides the SSH port (default: auto-detect). ' +
      'With a password, authentication happens automatically — useful in scripts via node().',
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
        command: 'scp("/usr/bin/nmap", "guest@192.168.1.50:/home/guest/nmap")',
        description: 'Copy nmap binary to remote machine',
      },
      {
        command: 'scp("/usr/bin/node", "guest@185.13.117.85:/home/guest", 25)',
        description: 'Copy via forwarded SSH port',
      },
      {
        command: 'scp("/usr/bin/nmap", "guest@192.168.1.50:/home/guest", "secret")',
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
      throw new Error('scp: missing operand\nUsage: scp(source, "user@host:path"[, port])');
    }

    const sourcePath = args[0];
    const destStr = args[1];

    // Overloaded args: scp(src, dst, password?) or scp(src, dst, port, password?)
    const thirdArg = args[2];
    const fourthArg = args[3];

    const dest = parseDestination(destStr);
    if (!dest) {
      throw new Error(
        `scp: invalid destination format: '${destStr}'\nUsage: scp(source, "user@host:path")`,
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

    // Parse optional port argument; when omitted, auto-detect SSH service
    const explicitPort =
      typeof thirdArg === 'number'
        ? Number.isInteger(thirdArg) && thirdArg >= 1 && thirdArg <= 65535
          ? thirdArg
          : (() => {
              throw new Error(`scp: invalid port '${String(thirdArg)}'`);
            })()
        : undefined;

    const password =
      typeof thirdArg === 'string'
        ? thirdArg
        : typeof fourthArg === 'string'
          ? fourthArg
          : undefined;

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

            const result = createFileOnMachine(
              resolvedHost,
              destPath,
              '/',
              content,
              remoteUser.userType,
              sourceNode.permissions,
            );

            if (!result.allowed) {
              onLine(`scp: ${destPath}: ${result.error}`);
            } else {
              onLine(`${fileName}  ${bytes} bytes  ${currentMachine} → ${dest.host}`);
            }

            onComplete();
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
