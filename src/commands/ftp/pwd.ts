import type { Command } from '../../components/Terminal/types';

type FtpPwdContext = {
  readonly getRemoteCwd: () => string;
};

export const createFtpPwdCommand = (context: FtpPwdContext): Command => ({
  name: 'pwd',
  category: 'network',
  description: 'Print remote working directory',
  manual: {
    synopsis: 'pwd',
    description: 'Display the current working directory on the remote FTP server.',
    examples: [{ command: 'pwd', description: 'Show current remote directory' }],
  },
  fn: (): string => context.getRemoteCwd(),
});
