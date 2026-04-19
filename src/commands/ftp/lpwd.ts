import type { Command } from '../../components/Terminal/types';

type FtpLpwdContext = {
  readonly getOriginCwd: () => string;
};

export const createFtpLpwdCommand = (context: FtpLpwdContext): Command => ({
  name: 'lpwd',
  category: 'network',
  description: 'Print local working directory',
  manual: {
    synopsis: 'lpwd',
    description:
      'Display the current working directory on the local machine (where the FTP connection was initiated from).',
    examples: [{ command: 'lpwd', description: 'Show current local directory' }],
  },
  fn: (): string => context.getOriginCwd(),
});
