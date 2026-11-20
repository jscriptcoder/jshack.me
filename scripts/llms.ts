/**
 * Build-time llms.txt companions. Reads the hand-written `public/llms.txt` and emits two
 * gitignored files beside it, both rendered from the live command registry:
 *
 * - `public/llms/commands.md`, the `help` listing and every `man` page, linked from llms.txt.
 * - `public/llms-full.txt`, llms.txt with that page after it, for agents that fetch one file.
 *
 * Run by the `predev`/`prebuild` npm hooks after `encode`, because the registry imports the
 * encoded secrets. Being generated on every build is the point: the hand-written llms.txt went
 * stale within weeks, and these cannot.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCommandReference, renderLlmsFull } from '../src/core/commands/commandReference.js';
import { commandRegistry } from '../src/core/commands/registry.js';

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public');

const write = (relativePath: string, content: string): void => {
  const outPath = resolve(publicDir, relativePath);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, content, 'utf-8');
  console.log(`Wrote ${outPath}`);
};

const commandReference = renderCommandReference([...commandRegistry.values()]);
const llmsTxt = readFileSync(resolve(publicDir, 'llms.txt'), 'utf-8');

write('llms/commands.md', commandReference);
write('llms-full.txt', renderLlmsFull({ llmsTxt, commandReference }));
