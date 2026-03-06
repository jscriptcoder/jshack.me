import type { Command } from '../components/Terminal/types';
import type { FileNode, FilePermissions, PermissionResult } from '../filesystem/types';
import type { UserType } from '../session/SessionContext';
import type { RemoteMachine } from '../network/types';

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
  fn: (...args: unknown[]): string => {
    const { getMachine, getLocalIP, getCurrentMachine, resolvePath, getNode, createFileOnMachine } =
      context;

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

    // Read source content
    const content = sourceNode.content ?? '';

    // Create file on remote machine preserving source permissions
    const currentMachine = getCurrentMachine();
    const result = createFileOnMachine(
      dest.host,
      dest.path,
      '/',
      content,
      remoteUser.userType,
      sourceNode.permissions,
    );

    if (!result.allowed) {
      throw new Error(`scp: ${dest.path}: ${result.error}`);
    }

    const fileName = dest.path.split('/').pop() ?? dest.path;
    const bytes = content.length;
    return `${fileName}  ${bytes} bytes  ${currentMachine} → ${dest.host}`;
  },
});
