import type { Command, AsyncOutput } from '../../components/Terminal/types';
import type { FileNode, PermissionResult } from '../../filesystem/types';
import type { UserType } from '../../session/SessionContext';
import type { MachineId } from '../../filesystem/machineFileSystems';
import { createCancellationToken, jitter } from '../../utils/asyncCommand';

type FtpPutContext = {
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

export const createFtpPutCommand = (context: FtpPutContext): Command => ({
  name: 'put',
  category: 'network',
  description: 'Upload file to remote server',
  manual: {
    synopsis: 'put(localFile, [remotePath])',
    description:
      'Upload a file from the local machine to the remote FTP server. ' +
      'If remotePath is not specified, the file is saved in the current remote directory with the same name.',
    arguments: [
      { name: 'localFile', description: 'Path to the file on the local machine', required: true },
      {
        name: 'remotePath',
        description: 'Destination path on remote server (optional)',
        required: false,
      },
    ],
    examples: [
      {
        command: 'put("/home/jshacker/payload.sh")',
        description: 'Upload to current remote directory',
      },
      {
        command: 'put("/tmp/data.txt", "/srv/ftp/uploads/data.txt")',
        description: 'Upload to specific remote path',
      },
    ],
  },
  fn: (localFile?: unknown, remotePath?: unknown): AsyncOutput => {
    if (typeof localFile !== 'string' || !localFile) {
      throw new Error('put: missing local file argument\nUsage: put("localFile", ["remotePath"])');
    }

    const remoteMachine = context.getRemoteMachine();
    const remoteCwd = context.getRemoteCwd();
    const remoteUserType = context.getRemoteUserType();

    const originMachine = context.getOriginMachine();
    const originCwd = context.getOriginCwd();
    const originUserType = context.getOriginUserType();

    // Resolve local path
    const resolvedLocalPath = context.resolvePathForMachine(localFile, originCwd);

    // Check local file exists and is readable
    const localNode = context.getNodeFromMachine(originMachine, resolvedLocalPath, '/');
    if (!localNode) {
      throw new Error(`put: ${localFile}: No such file or directory`);
    }
    if (localNode.type !== 'file') {
      throw new Error(`put: ${localFile}: Is a directory`);
    }

    // Read local file content
    const content = context.readFileFromMachine(
      originMachine,
      resolvedLocalPath,
      '/',
      originUserType,
    );
    if (content === null) {
      throw new Error(`put: ${localFile}: Permission denied`);
    }

    // Determine remote destination
    const fileName = resolvedLocalPath.split('/').pop() ?? localFile;
    const remoteDestination =
      typeof remotePath === 'string'
        ? remotePath
        : remoteCwd === '/'
          ? `/${fileName}`
          : `${remoteCwd}/${fileName}`;
    const resolvedRemotePath = context.resolvePathForMachine(remoteDestination, remoteCwd);

    // Pre-validate remote destination before starting async transfer
    const remoteNode = context.getNodeFromMachine(remoteMachine, resolvedRemotePath, '/');
    if (remoteNode && remoteNode.type !== 'file') {
      throw new Error(`put: remote path ${remoteDestination}: Is a directory`);
    }

    const bytes = content.length;
    const token = createCancellationToken();
    const STEP_MS = 300;

    return {
      __type: 'async',
      start: (onLine, onComplete) => {
        let phase = 0;

        onLine(`200 PORT command successful.`);

        token.schedule(
          () => {
            if (token.isCancelled()) return;
            onLine(`150 Opening BINARY mode data connection for ${fileName} (${bytes} bytes).`);
          },
          jitter(++phase * STEP_MS),
        );

        const steps = [0, 25, 50, 75, 100];
        steps.forEach((pct) => {
          token.schedule(
            () => {
              if (token.isCancelled()) return;
              const transferred = Math.floor((bytes * pct) / 100);
              const bar = '#'.repeat(Math.floor(pct / 5)).padEnd(20, ' ');
              onLine(`${fileName}  ${pct}% [${bar}]  ${transferred}/${bytes} bytes`);
            },
            jitter(++phase * STEP_MS),
          );
        });

        token.schedule(
          () => {
            if (token.isCancelled()) return;

            // Perform the actual file write
            const result = remoteNode
              ? context.writeFileToMachine(
                  remoteMachine,
                  resolvedRemotePath,
                  '/',
                  content,
                  remoteUserType,
                )
              : context.createFileOnMachine(
                  remoteMachine,
                  resolvedRemotePath,
                  '/',
                  content,
                  remoteUserType,
                );

            if (!result.allowed) {
              onLine(`put: remote path ${remoteDestination}: ${result.error}`);
            } else {
              onLine(`226 Transfer complete.`);
              onLine(`${bytes} bytes sent`);
            }

            onComplete();
          },
          jitter(++phase * STEP_MS),
        );
      },
      cancel: token.cancel,
    };
  },
});
