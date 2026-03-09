import type { Command } from '../../components/Terminal/types';

export type FtpQuitOutput = {
  readonly __type: 'ftp_quit';
};

export const ftpQuitCommand: Command = {
  name: 'quit',
  category: 'network',
  description: 'Close FTP connection',
  manual: {
    synopsis: 'quit()',
    description: 'Close the FTP connection and return to the local machine.',
    examples: [{ command: 'quit()', description: 'Exit FTP session' }],
  },
  fn: (): FtpQuitOutput => ({
    __type: 'ftp_quit',
  }),
};

export const ftpByeCommand: Command = {
  name: 'bye',
  category: 'network',
  description: 'Close FTP connection',
  manual: {
    synopsis: 'bye()',
    description: 'Close the FTP connection and return to the local machine. Alias for quit().',
    examples: [{ command: 'bye()', description: 'Exit FTP session' }],
  },
  fn: (): FtpQuitOutput => ({
    __type: 'ftp_quit',
  }),
};
