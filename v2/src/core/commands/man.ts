/**
 * man — display the manual page for a command.
 *
 * Ported from legacy (`src/commands/man.ts`), adapted to v2's simpler
 * `ManualPage` (synopsis + description + plain-string examples; no `arguments`
 * metadata). Renders NAME / SYNOPSIS / DESCRIPTION / EXAMPLES; a command with
 * no `manual` falls back to a single "no detailed manual" line.
 *
 * `formatManPage` is pure (takes the command, returns lines) so it's testable
 * with fixtures. `man`'s `execute` parses the argument, looks the command up in
 * the live registry, and surfaces the no-arg / unknown-command errors.
 *
 * Like `help`, the registry is pulled in via a runtime `import('./registry')`
 * inside `execute`, NOT a static top-level import: `registry.ts` statically
 * imports `man` to list it among the builtins, so a static back-edge here would
 * form a load-order cycle that crashes when `man` is imported before the
 * registry (e.g. its own test).
 */

import type { Command, ManualPage, TerminalLine } from './types';

const text = (content: string): TerminalLine => ({ kind: 'text', content });
const error = (content: string): TerminalLine => ({ kind: 'error', content });

const BODY_INDENT = '    ';

/** SYNOPSIS / DESCRIPTION / EXAMPLES — only the sections the manual populates. */
const manualSections = (manual: ManualPage): readonly TerminalLine[] => {
  const examples = manual.examples ?? [];
  return [
    text('SYNOPSIS'),
    text(`${BODY_INDENT}${manual.synopsis}`),
    text(''),
    text('DESCRIPTION'),
    text(`${BODY_INDENT}${manual.description}`),
    text(''),
    ...(examples.length > 0
      ? [text('EXAMPLES'), ...examples.map((example) => text(`${BODY_INDENT}${example}`)), text('')]
      : []),
  ];
};

export const formatManPage = (command: Command): readonly TerminalLine[] => [
  text(`${command.name.toUpperCase()}(1)`),
  text(''),
  text('NAME'),
  text(`${BODY_INDENT}${command.name} - ${command.description}`),
  text(''),
  ...(command.manual !== undefined
    ? manualSections(command.manual)
    : [text('No detailed manual available for this command.'), text('')]),
];

const execute: Command['execute'] = async (_env, args) => {
  const name = args[0];
  if (name === undefined) {
    return {
      kind: 'sync',
      lines: [error('man: missing command name'), error('Usage: man <command>')],
      exitCode: 2,
    };
  }

  const { commandRegistry } = await import('./registry');
  const command = commandRegistry.get(name);
  if (command === undefined) {
    return {
      kind: 'sync',
      lines: [error(`man: no manual entry for '${name}'`)],
      exitCode: 1,
    };
  }

  return { kind: 'sync', lines: formatManPage(command), exitCode: 0 };
};

export const man: Command = {
  name: 'man',
  description: 'Display the manual for a command',
  category: 'general',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'man <command>',
    description:
      'Display detailed documentation for a command, including its synopsis, description, and usage examples. Use `help` to list every available command.',
    examples: ['man ls', 'man grep'],
  },
  execute,
};
