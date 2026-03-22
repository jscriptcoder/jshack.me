import type { Command, AsyncOutput } from '../../components/Terminal/types';
import type { FileNode, PermissionResult } from '../../filesystem/types';
import type { UserType } from '../../session/SessionContext';
import type { MachineId } from '../../filesystem/machineFileSystems';
import { createCancellationToken, jitter } from '../../utils/asyncCommand';

type FtpGetContext = {
  readonly getRemoteMachine: () => MachineId;
  readonly getRemoteCwd: () => string;
  readonly getRemoteUserType: () => UserType;
  readonly getOriginMachine: () => MachineId;
  readonly getOriginCwd: () => string;
  readonly getOriginUserType: () => UserType;
  readonly resolvePathForMachine: (path: string, cwd: string) => string;
  readonly getNodeFromMachine: (machineId: MachineId, path: string, cwd: string) => FileNode | null;
  readonly readFileFromMachine: (
    machineId: MachineId,
    path: string,
    cwd: string,
    userType: UserType,
  ) => string | null;
  readonly createFileOnMachine: (
    machineId: MachineId,
    path: string,
    cwd: string,
    content: string,
    userType: UserType,
  ) => PermissionResult;
  readonly writeFileToMachine: (
    machineId: MachineId,
    path: string,
    cwd: string,
    content: string,
    userType: UserType,
  ) => PermissionResult;
};

export const createFtpGetCommand = (context: FtpGetContext): Command => ({
  name: 'get',
  category: 'network',
  description: 'Download file from remote server',
  manual: {
    synopsis: 'get(remoteFile, [localPath])',
    description:
      'Download a file from the remote FTP server to the local machine. ' +
      'If localPath is not specified, the file is saved in the current local directory with the same name.',
    arguments: [
      { name: 'remoteFile', description: 'Path to the file on the remote server', required: true },
      {
        name: 'localPath',
        description: 'Destination path on local machine (optional)',
        required: false,
      },
    ],
    examples: [
      {
        command: 'get("secret.txt")',
        description: 'Download secret.txt to current local directory',
      },
      {
        command: 'get("data.txt", "/tmp/data.txt")',
        description: 'Download to specific local path',
      },
    ],
  },
  fn: (remoteFile?: unknown, localPath?: unknown): AsyncOutput => {
    if (typeof remoteFile !== 'string' || !remoteFile) {
      throw new Error('get: missing remote file argument\nUsage: get("remoteFile", ["localPath"])');
    }

    const remoteMachine = context.getRemoteMachine();
    const remoteCwd = context.getRemoteCwd();
    const remoteUserType = context.getRemoteUserType();

    const originMachine = context.getOriginMachine();
    const originCwd = context.getOriginCwd();
    const originUserType = context.getOriginUserType();

    // Resolve remote path
    const resolvedRemotePath = context.resolvePathForMachine(remoteFile, remoteCwd);

    // Check remote file exists and is readable
    const remoteNode = context.getNodeFromMachine(remoteMachine, resolvedRemotePath, '/');
    if (!remoteNode) {
      throw new Error(`get: ${remoteFile}: No such file or directory`);
    }
    if (remoteNode.type !== 'file') {
      throw new Error(`get: ${remoteFile}: Is a directory`);
    }

    // Read remote file content
    const content = context.readFileFromMachine(
      remoteMachine,
      resolvedRemotePath,
      '/',
      remoteUserType,
    );
    if (content === null) {
      throw new Error(`get: ${remoteFile}: Permission denied`);
    }

    // Determine local destination
    const fileName = resolvedRemotePath.split('/').pop() ?? remoteFile;
    const localDestination =
      typeof localPath === 'string'
        ? localPath
        : originCwd === '/'
          ? `/${fileName}`
          : `${originCwd}/${fileName}`;
    const resolvedLocalPath = context.resolvePathForMachine(localDestination, originCwd);

    // Pre-validate local destination before starting async transfer
    const localNode = context.getNodeFromMachine(originMachine, resolvedLocalPath, '/');
    if (localNode && localNode.type !== 'file') {
      throw new Error(`get: local path ${localDestination}: Is a directory`);
    }

    const bytes = content.length;
    const token = createCancellationToken();
    const STEP_MS = 300;

    return {
      __type: 'async',
      start: (onLine, onComplete) => {
        let delay = 0;

        onLine(`200 PORT command successful.`);

        delay += jitter(STEP_MS);
        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine(`150 Opening BINARY mode data connection for ${fileName} (${bytes} bytes).`);
        }, delay);

        const steps = [0, 25, 50, 75, 100];
        steps.forEach((pct) => {
          delay += jitter(STEP_MS);
          token.schedule(() => {
            if (token.isCancelled()) return;
            const transferred = Math.floor((bytes * pct) / 100);
            const bar = '#'.repeat(Math.floor(pct / 5)).padEnd(20, ' ');
            onLine(`${fileName}  ${pct}% [${bar}]  ${transferred}/${bytes} bytes`);
          }, delay);
        });

        // Actual transfer + completion
        delay += jitter(STEP_MS);
        token.schedule(() => {
          if (token.isCancelled()) return;

          // Perform the actual file write
          const result = localNode
            ? context.writeFileToMachine(
                originMachine,
                resolvedLocalPath,
                '/',
                content,
                originUserType,
              )
            : context.createFileOnMachine(
                originMachine,
                resolvedLocalPath,
                '/',
                content,
                originUserType,
              );

          if (!result.allowed) {
            onLine(`get: local path ${localDestination}: ${result.error}`);
          } else {
            onLine(`226 Transfer complete.`);
            onLine(`${bytes} bytes received`);
          }

          onComplete();
        }, delay);
      },
      cancel: token.cancel,
    };
  },
});
