import type { Command, CommandManual } from '../components/Terminal/types';

const buildManualLines = (manual: CommandManual): readonly string[] => [
  'SYNOPSIS',
  `    ${manual.synopsis}`,
  '',
  'DESCRIPTION',
  `    ${manual.description}`,
  '',
  ...(manual.arguments && manual.arguments.length > 0
    ? [
        'ARGUMENTS',
        ...manual.arguments.flatMap((arg) => [
          `    ${arg.name}${arg.required ? ' (required)' : ' (optional)'}`,
          `        ${arg.description}`,
        ]),
        '',
      ]
    : []),
  ...(manual.examples && manual.examples.length > 0
    ? [
        'EXAMPLES',
        ...manual.examples.flatMap((ex) => [`    ${ex.command}`, `        ${ex.description}`, '']),
      ]
    : []),
];

export const createManCommand = (getCommands: () => Map<string, Command>): Command => ({
  name: 'man',
  category: 'general',
  description: 'Display manual for a command',
  manual: {
    synopsis: 'man <command>',
    description:
      'Display detailed documentation for a command, including description, arguments, and usage examples.',
    arguments: [
      { name: 'command', description: 'The name of the command to get help for', required: true },
    ],
    examples: [
      { command: 'man ls', description: 'Show manual for the ls command' },
      { command: 'man cat', description: 'Show manual for the cat command' },
    ],
  },
  fn: (...args: unknown[]): string => {
    const cmdName = args[0] as string | undefined;

    if (!cmdName) {
      throw new Error('man: missing command name\nUsage: man <command>');
    }

    const commands = getCommands();
    const cmd = commands.get(cmdName);

    if (!cmd) {
      throw new Error(`man: no manual entry for '${cmdName}'`);
    }

    const lines = [
      `${cmd.name.toUpperCase()}(1)`,
      '',
      'NAME',
      `    ${cmd.name} - ${cmd.description}`,
      '',
      ...(cmd.manual
        ? buildManualLines(cmd.manual)
        : ['No detailed manual available for this command.', '']),
    ];

    return lines.join('\n');
  },
});
