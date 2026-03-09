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
    synopsis: 'scp(source, destination)',
    description:
      'Copy a file from the current machine to a remote machine via SSH. ' +
      'The destination uses user@host:path format. Preserves file permissions from the source. ' +
      'Requires SSH (port 22) to be open on the target machine.',
    arguments: [
      { name: 'source', description: 'Path to the file on the current machine', required: true },
      {
        name: 'destination',
        description: 'Remote destination in user@host:path format',
        required: true,
      },
    ],
    examples: [
      {
        command: 'scp("/usr/bin/nmap", "guest@192.168.1.50:/home/guest/nmap")',
        description: 'Copy nmap binary to remote machine',
      },
      {
        command: 'scp("/tmp/exploit.sh", "ftpuser@10.0.0.5:/home/ftpuser/exploit.sh")',
        description: 'Copy script to remote server',
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
      throw new Error('scp: missing operand\nUsage: scp(source, "user@host:path")');
    }

    const sourcePath = args[0];
    const destStr = args[1];

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

    // Validate remote machine SSH access
    const machine = getMachine(dest.host);
    if (!machine) {
      throw new Error(`scp: connect to host ${dest.host} port 22: Connection refused`);
    }

    const sshPort = machine.ports.find((p) => p.port === 22 && p.service === 'ssh');
    if (!sshPort || !sshPort.open) {
      throw new Error(`scp: connect to host ${dest.host} port 22: Connection refused`);
    }

    // Validate remote user exists
    const remoteUser = machine.users.find((u) => u.username === dest.user);
    if (!remoteUser) {
      throw new Error(`scp: ${dest.user}@${dest.host}: Permission denied (publickey)`);
    }

    // NAT resolution: in forwarded mode, the public router IP maps to the
    // internal entry machine. Filesystem operations use the resolved IP.
    const resolvedHost = resolveNat(dest.host, 22).ip;

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
          let phase = 0;

          const steps = [0, 25, 50, 75, 100];
          steps.forEach((pct) => {
            transferToken.schedule(
              () => {
                if (transferToken.isCancelled()) return;
                const transferred = Math.floor((bytes * pct) / 100);
                const bar = '#'.repeat(Math.floor(pct / 5)).padEnd(20, ' ');
                onLine(`${fileName}  ${pct}% [${bar}]  ${transferred}/${bytes} bytes`);
              },
              jitter(++phase * PROGRESS_STEP_MS),
            );
          });

          // Actual transfer + summary
          transferToken.schedule(
            () => {
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
            },
            jitter(++phase * PROGRESS_STEP_MS),
          );
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
              performTransfer,
            };

            onComplete(scpPrompt);
          }, jitter(HANDSHAKE_MS));
        }, jitter(CONNECT_MS));
      },
      cancel: token.cancel,
    };
  },
});
