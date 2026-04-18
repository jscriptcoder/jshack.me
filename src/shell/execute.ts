import type { AsyncOutput, Command } from '../components/Terminal/types';
import { isAsyncOutput } from '../components/Terminal/types';
import type { Pipeline, ShellContext, Stage } from './types';

export type RedirectWriter = (path: string, content: string) => void;

export type ExecuteOptions = {
  readonly redirectWriter?: RedirectWriter;
};

const collectAsyncOutputSync = (asyncOutput: AsyncOutput): string => {
  const lines: string[] = [];
  let completed = false;
  asyncOutput.start(
    (line) => lines.push(line),
    () => {
      completed = true;
    },
  );
  if (!completed) {
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
  if (isAsyncOutput(result)) return collectAsyncOutputSync(result);
  if (result === undefined || result === null) return '';
  throw new Error('bash: pipe: intermediate stage produced an unsupported output type');
};

// Wrap an async output so lines still stream to the terminal while also being collected
// and written to the redirect target when the producer finishes.
const teeAsyncToFile = (
  source: AsyncOutput,
  path: string,
  writer: RedirectWriter,
): AsyncOutput => ({
  __type: 'async',
  clearScreen: source.clearScreen,
  cancel: source.cancel,
  start: (emit, done) => {
    const lines: string[] = [];
    source.start(
      (line) => {
        lines.push(line);
        emit(line);
      },
      (followUp) => {
        try {
          writer(path, lines.join('\n'));
        } catch (err) {
          emit(`bash: ${err instanceof Error ? err.message : String(err)}`);
        }
        done(followUp);
      },
    );
  },
});

const applyRedirect = (result: unknown, path: string, writer: RedirectWriter): unknown => {
  if (isAsyncOutput(result)) return teeAsyncToFile(result, path, writer);

  const content =
    typeof result === 'string'
      ? result
      : result === undefined || result === null
        ? ''
        : String(result);

  writer(path, content);
  return undefined;
};

export const execute = (
  pipeline: Pipeline,
  registry: ReadonlyMap<string, Command>,
  options?: ExecuteOptions,
): unknown => {
  if (pipeline.stages.length === 0) return undefined;

  if (pipeline.redirect && !options?.redirectWriter) {
    throw new Error('bash: redirect: no writer configured');
  }

  const intermediateStages = pipeline.stages.slice(0, -1);
  const finalStage = pipeline.stages[pipeline.stages.length - 1];

  const stdinForFinal = intermediateStages.reduce<string | undefined>(
    (stdin, stage) => materializeStdin(runStage(stage, registry, stdin)),
    undefined,
  );

  const finalResult = runStage(finalStage, registry, stdinForFinal);

  if (pipeline.redirect && options?.redirectWriter) {
    return applyRedirect(finalResult, pipeline.redirect.path, options.redirectWriter);
  }

  return finalResult;
};
