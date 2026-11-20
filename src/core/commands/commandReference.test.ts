import { describe, expect, it } from 'vitest';
import { renderCommandReference, renderLlmsFull } from './commandReference.js';
import { formatCommandList } from './help.js';
import { formatManPage } from './man.js';
import { commandRegistry } from './registry.js';
import type { Command, TerminalLine } from './types.js';

/** The formatters only read name/description/category/manual, so `execute` is
 *  a no-op stub. */
const buildCommand = (
  overrides: Partial<Command> & Pick<Command, 'name' | 'category'>,
): Command => ({
  description: `desc for ${overrides.name}`,
  tier: 'guest',
  availability: { kind: 'any-machine' },
  execute: async () => ({ kind: 'sync', lines: [], exitCode: 0 }),
  ...overrides,
});

/** What the terminal shows for a set of lines: their text, one per line. */
const asPrinted = (lines: readonly TerminalLine[]): string =>
  lines.map((line) => line.content).join('\n');

const allCommands = [...commandRegistry.values()];

describe('renderCommandReference', () => {
  it('opens with the help listing, worded exactly as the terminal prints it', () => {
    const reference = renderCommandReference(allCommands);

    const listing = asPrinted(formatCommandList(allCommands));
    expect(reference).toContain(listing);
    expect(reference.indexOf(listing)).toBeLessThan(reference.indexOf('LS(1)'));
  });

  it('carries every command in the game with its man page, worded exactly as man prints it', () => {
    const reference = renderCommandReference(allCommands);

    allCommands.forEach((command) => {
      expect(reference).toContain(`### ${command.name}\n`);
      expect(reference).toContain(asPrinted(formatManPage(command)));
    });
  });

  it('gives a command with no manual its section too', () => {
    const reference = renderCommandReference([buildCommand({ name: 'bare', category: 'general' })]);

    expect(reference).toContain('### bare\n');
    expect(reference).toContain('No detailed manual available for this command.');
  });

  it('lists the man pages alphabetically, whatever order the commands come in', () => {
    const reference = renderCommandReference([
      buildCommand({ name: 'zeta', category: 'general' }),
      buildCommand({ name: 'alpha', category: 'network' }),
    ]);

    expect(reference.indexOf('### alpha')).toBeGreaterThan(-1);
    expect(reference.indexOf('### alpha')).toBeLessThan(reference.indexOf('### zeta'));
  });

  it('keeps terminal text inside fenced blocks so markdown cannot reflow it', () => {
    const reference = renderCommandReference([buildCommand({ name: 'solo', category: 'general' })]);

    expect(reference).toContain('### solo\n\n```text\nSOLO(1)\n');
  });

  it('closes every fenced block, so the next section is not swallowed into it', () => {
    const reference = renderCommandReference([
      buildCommand({ name: 'first', category: 'general' }),
      buildCommand({ name: 'second', category: 'general' }),
    ]);

    expect(reference).toContain('```\n\n## Manual pages\n\n### first\n');
    expect(reference).toContain('```\n\n### second\n');
    expect(reference.endsWith('```\n')).toBe(true);
  });

  it('heads the listing and the manual pages with sections of their own', () => {
    const reference = renderCommandReference([buildCommand({ name: 'solo', category: 'general' })]);

    expect(reference).toContain('\n\n## help\n\n```text\n');
    expect(reference).toContain('\n\n## Manual pages\n\n### solo\n');
  });

  it('is a markdown document with a title', () => {
    expect(renderCommandReference([]).startsWith('# JSHACK.ME command reference\n')).toBe(true);
  });
});

describe('renderLlmsFull', () => {
  it('is llms.txt unchanged, followed by the command reference', () => {
    const llmsTxt = '# JSHACK.ME\n\n> A game.\n';
    const commandReference = '# JSHACK.ME command reference\n\nbody\n';

    expect(renderLlmsFull({ llmsTxt, commandReference })).toBe(
      '# JSHACK.ME\n\n> A game.\n\n# JSHACK.ME command reference\n\nbody\n',
    );
  });
});
