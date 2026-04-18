import type { AsyncOutput, Command } from '../components/Terminal/types';
import { isAsyncOutput } from '../components/Terminal/types';
import type { Pipeline, ShellContext, Stage } from './types';

const collectAsyncOutput = (asyncOutput: AsyncOutput): string => {
  const lines: string[] = [];
  let completed = false;
  asyncOutput.start(
    (line) => lines.push(line),
    () => {
      completed = true;
    },
  );
  if (!completed) {
    // Intermediate pipe stages must be synchronous so their stdout can be piped.
    // Commands that truly need async work (network calls) can't be intermediate for now.
    throw new Error('bash: pipe: async intermediate stages must complete synchronously');
  }
  return lines.join('\n');
};

const runStage = (
  stage: Stage,
  registry: ReadonlyMap<string, Command>,
  stdin: string | undefined,
): unknown => {
  const command = registry.get(stage.command);
  if (!command) {
    throw new Error(`bash: ${stage.command}: command not found`);
  }

  if (stdin !== undefined && command.fnShell) {
    const ctx: ShellContext = { stdin };
    return command.fnShell(ctx, ...stage.args);
  }

  return command.fn(...stage.args);
};

const materializeStdin = (result: unknown): string => {
  if (typeof result === 'string') return result;
  if (isAsyncOutput(result)) return collectAsyncOutput(result);
  if (result === undefined || result === null) return '';
  throw new Error('bash: pipe: intermediate stage produced an unsupported output type');
};

export const execute = (pipeline: Pipeline, registry: ReadonlyMap<string, Command>): unknown => {
  if (pipeline.stages.length === 0) return undefined;

  const intermediateStages = pipeline.stages.slice(0, -1);
  const finalStage = pipeline.stages[pipeline.stages.length - 1];

  const stdinForFinal = intermediateStages.reduce<string | undefined>(
    (stdin, stage) => materializeStdin(runStage(stage, registry, stdin)),
    undefined,
  );

  return runStage(finalStage, registry, stdinForFinal);
};
