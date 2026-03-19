import type { Command } from '../../components/Terminal/types';

export const ncHelpCommand: Command = {
  name: 'help',
  category: 'network',
  description: 'Show available commands',
  fn: (): string => 'pwd  cd  ls  cat  whoami  bash  exit',
};
