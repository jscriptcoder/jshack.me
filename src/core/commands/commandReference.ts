/**
 * commandReference — the game's `help` listing and every `man` page as one
 * markdown document, for LLM agents that read the published llms.txt pages
 * before they open the terminal (see `scripts/llms.ts`).
 *
 * It reuses the terminal's own formatters, so the page says exactly what a
 * player sees on typing `help` or `man <command>`, and a command added or
 * re-documented reaches the page at the next build with no hand edit. Every
 * registry command is included: in-game `help` already lists them all,
 * installed or not, so the page gives an agent nothing a player lacks.
 *
 * Terminal text sits in fenced blocks because it is column-aligned plain
 * text; markdown would reflow it.
 */

import { formatCommandList } from './help.js';
import { formatManPage } from './man.js';
import type { Command, TerminalLine } from './types.js';

const TITLE = '# JSHACK.ME command reference';

const INTRO =
  "> Every command in JSHACK.ME, as the game's own `help` and `man` print them. Generated from the game at build time. Some tools are not installed on a new workstation; `help` lists them all the same.";

const fenced = (lines: readonly TerminalLine[]): string =>
  ['```text', ...lines.map((line) => line.content), '```'].join('\n');

const manSection = (command: Command): string =>
  `### ${command.name}\n\n${fenced(formatManPage(command))}`;

export const renderCommandReference = (commands: readonly Command[]): string => {
  const byName = [...commands].sort((left, right) => left.name.localeCompare(right.name));
  return [
    TITLE,
    INTRO,
    '## help',
    fenced(formatCommandList(commands)),
    '## Manual pages',
    ...byName.map(manSection),
  ]
    .join('\n\n')
    .concat('\n');
};

/** llms.txt with the command reference after it, for agents that fetch one
 *  file. llms.txt keeps its text as written, trailing blank lines aside, and
 *  one blank line separates the two. */
export const renderLlmsFull = ({
  llmsTxt,
  commandReference,
}: {
  readonly llmsTxt: string;
  readonly commandReference: string;
}): string => `${llmsTxt.trimEnd()}\n\n${commandReference}`;
