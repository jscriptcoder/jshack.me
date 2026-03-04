import type { UserType } from '../session/SessionContext';
import type { Command } from '../components/Terminal/types';

const PRIVILEGE_LEVEL: Readonly<Record<UserType, number>> = {
  guest: 0,
  user: 1,
  root: 2,
};

const PRIVILEGE_LABEL: Readonly<Record<UserType, string>> = {
  guest: 'guest',
  user: 'user',
  root: 'root',
};

// Commands not listed here are unrestricted (available to all user types)
export const COMMAND_TIERS: Readonly<Record<string, UserType>> = {
  // user-level commands
  apt: 'user',
  ifconfig: 'user',
  ping: 'user',
  nmap: 'user',
  nslookup: 'user',
  ssh: 'user',
  ftp: 'user',
  nc: 'user',
  curl: 'user',
  strings: 'user',
  output: 'user',
  resolve: 'user',
  nano: 'user',
  node: 'user',
  airmon: 'user',
  airdump: 'user',
  aircrack: 'user',
  nmcli: 'user',
  exploit: 'user',
  john: 'user',
  hydra: 'user',
  gobuster: 'user',
  missions: 'user',
  accept: 'user',
  abort: 'user',
  mail: 'user',
  xterm: 'user',
  // root-level commands
  decrypt: 'root',
};

export const hasPrivilege = (current: UserType, required: UserType): boolean =>
  PRIVILEGE_LEVEL[current] >= PRIVILEGE_LEVEL[required];

export const getAccessibleCommandNames = (
  commandNames: readonly string[],
  userType: UserType,
): readonly string[] =>
  commandNames.filter((name) => {
    const required = COMMAND_TIERS[name];
    return required === undefined || hasPrivilege(userType, required);
  });

const createRestrictedFn =
  (name: string, requiredType: UserType): ((...args: readonly unknown[]) => never) =>
  (): never => {
    throw new Error(
      `permission denied: '${name}' requires ${PRIVILEGE_LABEL[requiredType]} privileges`,
    );
  };

export const applyCommandRestrictions = (
  commands: ReadonlyMap<string, Command>,
  userType: UserType,
): ReadonlyMap<string, Command> =>
  new Map(
    Array.from(commands.entries()).map(([name, cmd]): readonly [string, Command] => {
      const required = COMMAND_TIERS[name];
      if (required === undefined || hasPrivilege(userType, required)) {
        return [name, cmd];
      }
      return [name, { ...cmd, fn: createRestrictedFn(name, required) }];
    }),
  );
