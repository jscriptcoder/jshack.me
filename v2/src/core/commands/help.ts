/**
 * help — list every available command grouped into labelled sections.
 *
 * Ported from legacy (`src/commands/help.ts`). Commands are grouped by their
 * `category`, sections render in a fixed order (General → Filesystem → …),
 * empty sections are omitted, and commands within a section are sorted
 * alphabetically. Each row shows the command's synopsis (falling back to its
 * name) left-padded to ONE width shared across all sections, so descriptions
 * line up in a single column. A footer points at `man <command>` for detail.
 *
 * `formatCommandList` takes the command list as an argument (rather than
 * reaching for the registry) so it stays pure and testable with fixtures. The
 * `help` command supplies the live `commandRegistry` — the registry's doc
 * comment anticipates exactly this consumer.
 *
 * The registry is pulled in via a runtime `import('./registry')` inside
 * `execute`, NOT a static top-level import. `registry.ts` statically imports
 * `help` (to list it among the builtins); a static back-edge here would form a
 * load-order cycle that crashes whenever `help` is imported before the registry
 * (e.g. its own test). Deferring to runtime breaks the static cycle — by the
 * time `execute` runs, every command (including `help`) is fully initialized.
 */

import { COMMAND_CATEGORIES, type Command, type CommandCategory, type TerminalLine } from './types';

const CATEGORY_LABELS: Readonly<Record<CommandCategory, string>> = {
  general: 'General',
  filesystem: 'Filesystem',
  mission: 'Mission',
  network: 'Network',
  wifi: 'WiFi',
};

const FOOTER = ' Use man <command> for detailed help.';

/** Cosmetic gutter the section underline extends past the synopsis column,
 *  giving the rule room to span the description too. Ported from legacy's
 *  `synopsisWidth + 4 + 40`. Purely decorative — adjust freely. */
const SECTION_RULE_GUTTER = 44;

const synopsisOf = (command: Command): string => command.manual?.synopsis ?? command.name;

const formatSection = (
  label: string,
  commands: readonly Command[],
  synopsisWidth: number,
): readonly TerminalLine[] => {
  const sorted = [...commands].sort((left, right) => left.name.localeCompare(right.name));
  return [
    { kind: 'text', content: ` ${label}` },
    { kind: 'dim', content: ` ${'─'.repeat(synopsisWidth + SECTION_RULE_GUTTER)}` },
    ...sorted.map(
      (command): TerminalLine => ({
        kind: 'text',
        content: `   ${synopsisOf(command).padEnd(synopsisWidth)}  ${command.description}`,
      }),
    ),
    { kind: 'text', content: '' },
  ];
};

export const formatCommandList = (commands: readonly Command[]): readonly TerminalLine[] => {
  // One global synopsis width so descriptions align across every section.
  const synopsisWidth = commands.reduce((widest, command) => {
    return Math.max(widest, synopsisOf(command).length);
  }, 0);

  const sections = COMMAND_CATEGORIES.flatMap((category): readonly TerminalLine[] => {
    const inCategory = commands.filter((command) => command.category === category);
    if (inCategory.length === 0) return [];
    return formatSection(CATEGORY_LABELS[category], inCategory, synopsisWidth);
  });

  return [{ kind: 'text', content: '' }, ...sections, { kind: 'dim', content: FOOTER }];
};

const execute: Command['execute'] = async () => {
  const { commandRegistry } = await import('./registry');
  return {
    kind: 'sync',
    lines: formatCommandList([...commandRegistry.values()]),
    exitCode: 0,
  };
};

export const help: Command = {
  name: 'help',
  description: 'Display list of available commands',
  category: 'general',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'help',
    description:
      'Display a list of all available commands grouped by category, with their short descriptions. For detailed information about a specific command, use `man <command>`.',
    examples: [{ command: 'help', description: 'List all available commands grouped by category' }],
  },
  execute,
};
