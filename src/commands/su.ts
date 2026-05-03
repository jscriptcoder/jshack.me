import type { Command } from '../components/Terminal/types';
import type { UserType } from '../session/types';
import { md5 } from '../utils/md5';

export type PasswordPromptData = {
  readonly __type: 'password_prompt';
  readonly targetUser: string;
};

type RemoteUserInfo = {
  readonly username: string;
  readonly userType: UserType;
};

type SuContext = {
  readonly getUsers: () => readonly string[];
  readonly readFile: (path: string, userType: UserType) => string | null;
  readonly findMachineUsers: () => readonly RemoteUserInfo[];
  readonly setUsername: (username: string, userType: UserType) => void;
  readonly setCurrentPath: (path: string) => void;
  // Wraps SessionContext.pushSession with the current machine baked in by
  // the consumer (useCommands.ts). su.ts only needs to provide the
  // destination's user-side fields; the wrapper fills in machine + hostname.
  readonly pushSession: (destination: {
    readonly username: string;
    readonly userType: UserType;
    readonly currentPath: string;
  }) => void;
  readonly onAuthResult?: (success: boolean, targetUser: string) => void;
};

// Validates password against /etc/passwd MD5 hash
const validatePassword = (
  username: string,
  password: string,
  readFile: SuContext['readFile'],
): boolean => {
  const passwdContent = readFile('/etc/passwd', 'root');
  if (!passwdContent) return false;

  const entry = passwdContent.split('\n').find((line) => line.split(':')[0] === username);
  if (!entry) return false;

  const storedHash = entry.split(':')[1];
  if (!storedHash) return false;

  return storedHash === md5(password);
};

// Infers userType from machineUsers list, with name-based fallback
const resolveUserType = (username: string, machineUsers: readonly RemoteUserInfo[]): UserType => {
  const machineUser = machineUsers.find((u) => u.username === username);
  if (machineUser) return machineUser.userType;
  return username === 'root' ? 'root' : username === 'guest' ? 'guest' : 'user';
};

export const createSuCommand = (context: SuContext): Command => ({
  name: 'su',
  category: 'general',
  description: 'Switch user',
  manual: {
    synopsis: 'su <username> [password]',
    description:
      'Switch to another user account. Without a password, you will be prompted interactively. ' +
      'With a password, authentication happens inline — useful in scripts via node.',
    arguments: [
      {
        name: 'username',
        description: 'The username to switch to (e.g., "root", "guest")',
        required: true,
      },
      {
        name: 'password',
        description: 'Optional password for programmatic authentication',
        required: false,
      },
    ],
    examples: [
      { command: 'su root', description: 'Switch to root user (interactive prompt)' },
      { command: 'su root toor', description: 'Switch to root with password (scripting)' },
    ],
  },
  fn: (...args: unknown[]): PasswordPromptData | string => {
    const username = args[0] as string | undefined;
    const password = args[1] as string | undefined;

    if (!username) {
      throw new Error('su: missing username\nUsage: su <username>');
    }

    const validUsers = context.getUsers();
    if (!validUsers.includes(username)) {
      throw new Error(`su: user ${username} does not exist`);
    }

    // Programmatic auth: validate and switch inline
    if (password !== undefined) {
      if (!validatePassword(username, password, context.readFile)) {
        context.onAuthResult?.(false, username);
        throw new Error('su: Authentication failure');
      }

      const userType = resolveUserType(username, context.findMachineUsers());
      const homePath = userType === 'root' ? '/root' : `/home/${username}`;

      context.pushSession({ username, userType, currentPath: homePath });
      context.setUsername(username, userType);
      context.setCurrentPath(homePath);
      context.onAuthResult?.(true, username);

      return `Switched to user: ${username}`;
    }

    // Interactive: return prompt data for Terminal to handle
    return {
      __type: 'password_prompt',
      targetUser: username,
    };
  },
});
