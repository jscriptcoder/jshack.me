import type { Command, CommandCategory } from '../components/Terminal/types';

const CATEGORY_ORDER: readonly CommandCategory[] = [
  'general',
  'filesystem',
  'mission',
  'network',
  'wifi',
];

const CATEGORY_LABELS: Readonly<Record<CommandCategory, string>> = {
  general: 'General',
  filesystem: 'Filesystem',
  mission: 'Mission',
  network: 'Network',
  wifi: 'WiFi',
};

const formatCategory = (
  label: string,
  commands: readonly Command[],
  maxSynopsisWidth: number,
): readonly string[] => {
  const sorted = [...commands].sort((a, b) => a.name.localeCompare(b.name));

  return [
    ` ${label}`,
    ` ${'─'.repeat(maxSynopsisWidth + 4 + 40)}`,
    ...sorted.map((cmd) => {
      const synopsis = cmd.manual?.synopsis ?? cmd.name + '()';
      return `   ${synopsis.padEnd(maxSynopsisWidth)}  ${cmd.description}`;
    }),
    '',
  ];
};

export const createHelpCommand = (getCommands: () => Command[]): Command => ({
  name: 'help',
  category: 'general',
  description: 'Display list of available commands',
  manual: {
    synopsis: 'help',
    description:
      'Display a list of all available commands with their short descriptions. For detailed information about a specific command, use `man <command>`.',
    examples: [{ command: 'help', description: 'List all available commands' }],
  },
  fn: () => {
    const commands = getCommands();

    // Group commands by category
    const grouped = commands.reduce<Map<CommandCategory, Command[]>>((acc, cmd) => {
      const existing = acc.get(cmd.category) ?? [];
      acc.set(cmd.category, [...existing, cmd]);
      return acc;
    }, new Map());

    // Compute global synopsis width for consistent alignment across categories
    const maxSynopsisWidth = commands.reduce((max, cmd) => {
      const synopsis = cmd.manual?.synopsis ?? cmd.name + '()';
      return Math.max(max, synopsis.length);
    }, 0);

    const lines = CATEGORY_ORDER.filter((cat) => grouped.has(cat)).flatMap((cat) =>
      formatCategory(CATEGORY_LABELS[cat], grouped.get(cat)!, maxSynopsisWidth),
    );

    return ['', ...lines, ' Use man <command> for detailed help.'].join('\n');
  },
});
