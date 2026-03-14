import type { Command } from '../components/Terminal/types';

export type PasswordPromptData = {
  readonly __type: 'password_prompt';
  readonly targetUser: string;
};

type SuContext = {
  readonly getUsers: () => readonly string[];
};

export const createSuCommand = (context: SuContext): Command => ({
  name: 'su',
  category: 'general',
  description: 'Switch user',
  manual: {
    synopsis: 'su(username)',
    description:
      'Switch to another user account. You will be prompted for the password. The password is validated against MD5 hashes stored in /etc/passwd.',
    arguments: [
      {
        name: 'username',
        description: 'The username to switch to (e.g., "root", "guest")',
        required: true,
      },
    ],
    examples: [
      { command: 'su("root")', description: 'Switch to root user' },
      { command: 'su("guest")', description: 'Switch to guest user' },
    ],
  },
  fn: (...args: unknown[]): PasswordPromptData => {
    const username = args[0] as string | undefined;

    if (!username) {
      throw new Error('su: missing username\nUsage: su("username")');
    }

    const validUsers = context.getUsers();
    if (!validUsers.includes(username)) {
      throw new Error(`su: user ${username} does not exist`);
    }

    return {
      __type: 'password_prompt',
      targetUser: username,
    };
  },
});
