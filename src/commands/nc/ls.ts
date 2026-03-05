import type { Command } from '../../components/Terminal/types';
import type { FileNode, PermissionResult } from '../../filesystem/types';
import type { UserType } from '../../session/SessionContext';
import type { MachineId } from '../../filesystem/machineFileSystems';

type NcLsContext = {
  readonly getMachine: () => MachineId;
  readonly getCwd: () => string;
  readonly getUserType: () => UserType;
  readonly resolvePath: (path: string, cwd: string) => string;
  readonly getNodeFromMachine: (machineId: MachineId, path: string, cwd: string) => FileNode | null;
  readonly listDirectoryFromMachine: (
    machineId: MachineId,
    path: string,
    cwd: string,
    userType: UserType,
  ) => readonly string[] | null;
  readonly canTraverseOnMachine: (
    machineId: MachineId,
    path: string,
    userType: UserType,
  ) => PermissionResult;
};

export const createNcLsCommand = (context: NcLsContext): Command => ({
  name: 'ls',
  description: 'List directory contents',
  fn: (...args: unknown[]): string => {
    const {
      getMachine,
      getCwd,
      getUserType,
      resolvePath,
      getNodeFromMachine,
      listDirectoryFromMachine,
      canTraverseOnMachine,
    } = context;

    const stringArgs = args.filter((arg): arg is string => typeof arg === 'string');
    const showAll = stringArgs.some((arg) => arg.startsWith('-') && arg.includes('a'));
    const path = stringArgs.find((arg) => !arg.startsWith('-'));
    const machine = getMachine();
    const cwd = getCwd();
    const userType = getUserType();

    const targetPath = path ? resolvePath(path, cwd) : cwd;

    // Check traversal permissions on parent directories
    const traversal = canTraverseOnMachine(machine, targetPath, userType);
    if (!traversal.allowed) {
      throw new Error(`ls: ${path ?? cwd}: Permission denied`);
    }

    // Check if path exists
    const node = getNodeFromMachine(machine, targetPath, cwd);
    if (!node) {
      throw new Error(`ls: ${path ?? cwd}: No such file or directory`);
    }

    // If it's a file, just return the name
    if (node.type === 'file') {
      return node.name;
    }

    // Check read permission
    const canRead = node.permissions.read.includes(userType) || userType === 'root';
    if (!canRead) {
      throw new Error(`ls: ${path ?? cwd}: Permission denied`);
    }

    // List directory contents
    const entries = listDirectoryFromMachine(machine, targetPath, cwd, userType);
    if (entries === null) {
      throw new Error(`ls: ${path ?? cwd}: Permission denied`);
    }

    const visibleEntries = entries.filter((name) => showAll || !name.startsWith('.'));

    if (visibleEntries.length === 0) {
      return '(empty directory)';
    }

    // Add trailing slash to directories
    const formatted = visibleEntries.map((name) => {
      const childPath = targetPath === '/' ? `/${name}` : `${targetPath}/${name}`;
      const childNode = getNodeFromMachine(machine, childPath, cwd);
      return childNode?.type === 'directory' ? `${name}/` : name;
    });

    return formatted.join('  ');
  },
});
