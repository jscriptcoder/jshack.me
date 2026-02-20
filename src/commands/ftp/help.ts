import type { Command } from '../../components/Terminal/types';

const FTP_HELP_LINES: readonly string[] = [
  'FTP commands:',
  '',
  '  pwd()              Print remote working directory',
  '  lpwd()             Print local working directory',
  '  cd(path)           Change remote directory',
  '  lcd(path)          Change local directory',
  '  ls()               List remote directory',
  '  lls()              List local directory',
  '  get(file)          Download file from remote to local',
  '  put(file)          Upload file from local to remote',
  '  quit() / bye()     Close FTP connection',
];

export const ftpHelpCommand: Command = {
  name: 'help',
  description: 'Show available commands',
  fn: (): string => FTP_HELP_LINES.join('\n'),
};
