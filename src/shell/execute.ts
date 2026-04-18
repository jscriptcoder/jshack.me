import type { Command } from '../components/Terminal/types';
import type { Pipeline } from './types';

// Phase A: single-stage execution only. Pipes and redirects are rejected at parse time,
// so here we always see at most one stage.
export const execute = (pipeline: Pipeline, registry: ReadonlyMap<string, Command>): unknown => {
  if (pipeline.stages.length === 0) {
    return undefined;
  }

  const stage = pipeline.stages[0];
  const command = registry.get(stage.command);
  if (!command) {
    throw new Error(`bash: ${stage.command}: command not found`);
  }

  return command.fn(...stage.args);
};
