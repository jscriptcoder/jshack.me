import type { Command } from '../components/Terminal/types';

export const createHelpCommand = (getCommands: () => Command[]): Command => ({
  name: 'help',
  description: 'Display list of available commands',
  manual: {
    synopsis: 'help()',
    description:
      'Display a list of all available commands with their short descriptions. For detailed information about a specific command, use man(command).',
    examples: [{ command: 'help()', description: 'List all available commands' }],
  },
  fn: () => {
    const commands = getCommands();
    const sortedCommands = [...commands].sort((a, b) => a.name.localeCompare(b.name));

    const synopses = sortedCommands.map((cmd) => cmd.manual?.synopsis ?? cmd.name + '()');
    const maxWidth = synopses.reduce((max, s) => Math.max(max, s.length), 0);

    const lines = [
      'Available commands:',
      '',
      ...sortedCommands.map((cmd, i) => ` ${synopses[i]!.padEnd(maxWidth)}  ${cmd.description}`),
    ];

    return lines.join('\n');
  },
});
