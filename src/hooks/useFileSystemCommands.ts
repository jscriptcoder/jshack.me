import { useMemo } from 'react';
import { useFileSystem } from '../filesystem';
import { useSession } from '../session/SessionContext';
import { createPwdCommand } from '../commands/pwd';
import { createLsCommand } from '../commands/ls';
import { createCdCommand } from '../commands/cd';
import { createCatCommand } from '../commands/cat';
import { createWhoamiCommand } from '../commands/whoami';
import { createGpgCommand } from '../commands/gpg';
import { createOutputCommand } from '../commands/output';
import { createStringsCommand } from '../commands/strings';
import { createNanoCommand } from '../commands/nano';
import { createJohnCommand } from '../commands/john';
import { createRmCommand } from '../commands/rm';
import { createChmodCommand } from '../commands/chmod';
import { createFindCommand } from '../commands/find';
import { createGrepCommand } from '../commands/grep';
import type { Command } from '../components/Terminal/types';

export const useFileSystemCommands = (): Map<string, Command> => {
  const {
    resolvePath,
    getNode,
    createFile,
    writeFile,
    deleteNode,
    updatePermissions,
    canTraverse,
  } = useFileSystem();
  const { session, setCurrentPath } = useSession();

  return useMemo(() => {
    const commands = new Map<string, Command>();

    const getCurrentPath = () => session.currentPath;
    const getUserType = () => session.userType;
    const getUsername = () => session.username;
    const getHomePath = () => {
      if (session.userType === 'root') return '/root';
      if (session.userType === 'guest') return '/home/guest';
      return `/home/${session.username}`;
    };

    // Bind canTraverse to the current user type for command contexts
    const canTraverseFn = (path: string) => canTraverse(path, session.userType);

    // pwd command
    commands.set('pwd', createPwdCommand(getCurrentPath));

    // whoami command
    commands.set('whoami', createWhoamiCommand(getUsername));

    // ls command
    commands.set(
      'ls',
      createLsCommand({
        getCurrentPath,
        resolvePath,
        getNode,
        getUserType,
        canTraverse: canTraverseFn,
      }),
    );

    // cd command
    commands.set(
      'cd',
      createCdCommand({
        resolvePath,
        getNode,
        setCurrentPath,
        getUserType,
        getHomePath,
        canTraverse: canTraverseFn,
      }),
    );

    // cat command
    commands.set(
      'cat',
      createCatCommand({
        resolvePath,
        getNode,
        getUserType,
        canTraverse: canTraverseFn,
      }),
    );

    // gpg command
    commands.set(
      'gpg',
      createGpgCommand({
        resolvePath,
        getNode,
        getUserType,
        canTraverse: canTraverseFn,
      }),
    );

    // output command
    commands.set(
      'output',
      createOutputCommand({
        resolvePath,
        getNode,
        getUserType,
        createFile,
        writeFile,
      }),
    );

    // strings command
    commands.set(
      'strings',
      createStringsCommand({
        resolvePath,
        getNode,
        getUserType,
        canTraverse: canTraverseFn,
      }),
    );

    // nano command
    commands.set(
      'nano',
      createNanoCommand({
        resolvePath,
        getNode,
        getUserType,
        canTraverse: canTraverseFn,
      }),
    );

    // john command
    commands.set(
      'john',
      createJohnCommand({
        resolvePath,
        getNode,
        getUserType,
        canTraverse: canTraverseFn,
      }),
    );

    // rm command
    commands.set(
      'rm',
      createRmCommand({
        resolvePath,
        getNode,
        getUserType,
        deleteNode,
      }),
    );

    // chmod command
    commands.set(
      'chmod',
      createChmodCommand({
        resolvePath,
        getNode,
        getUserType,
        updatePermissions: (path: string, permissions) =>
          updatePermissions(path, permissions, session.userType),
        canTraverse: canTraverseFn,
      }),
    );

    // find command
    commands.set(
      'find',
      createFindCommand({
        getCurrentPath,
        resolvePath,
        getNode,
        getUserType,
        canTraverse: canTraverseFn,
      }),
    );

    // grep command
    commands.set(
      'grep',
      createGrepCommand({
        getCurrentPath,
        resolvePath,
        getNode,
        getUserType,
        canTraverse: canTraverseFn,
      }),
    );

    return commands;
  }, [
    setCurrentPath,
    resolvePath,
    getNode,
    createFile,
    writeFile,
    deleteNode,
    updatePermissions,
    canTraverse,
    session,
  ]);
};
