import type { Command, AsyncOutput } from '../components/Terminal/types';
import { stringify } from '../utils/stringify';
import { createCancellationToken, jitter } from '../utils/asyncCommand';

const RESOLVE_DELAY_MS = 100;

const isPromise = (value: unknown): value is Promise<unknown> =>
  value !== null &&
  typeof value === 'object' &&
  'then' in value &&
  typeof (value as Promise<unknown>).then === 'function';

export const createResolveCommand = (): Command => ({
  name: 'resolve',
  description: 'Unwrap a Promise and display its resolved value',
  manual: {
    synopsis: 'resolve(promise)',
    description:
      'Waits for a Promise to resolve and displays its value. ' +
      'Useful for unwrapping the result of async commands like output(ping(...)) ' +
      'when you forgot to use await. If the value is not a Promise, it is displayed directly.',
    arguments: [
      {
        name: 'promise',
        description: 'The Promise to resolve (or any value to display)',
        required: true,
      },
    ],
    examples: [
      {
        command: 'const p = output(ping("host")); resolve(p)',
        description: 'Resolve a Promise stored in a variable',
      },
      {
        command: 'resolve(myVariable)',
        description: 'Display the value of any variable',
      },
    ],
  },
  fn: (value: unknown): AsyncOutput => {
    const token = createCancellationToken();

    return {
      __type: 'async',
      start: (onLine, onComplete) => {
        if (!isPromise(value)) {
          onLine(stringify(value));
          onComplete();
          return;
        }

        onLine('Resolving...');

        token.schedule(() => {
          if (token.isCancelled()) return;

          value
            .then((resolved) => {
              if (token.isCancelled()) return;
              onLine('');
              onLine(stringify(resolved));
              onComplete();
            })
            .catch((error: unknown) => {
              if (token.isCancelled()) return;
              onLine('');
              const errorMessage = error instanceof Error ? error.message : String(error);
              onLine(`Error: ${errorMessage}`);
              onComplete();
            });
        }, jitter(RESOLVE_DELAY_MS));
      },
      cancel: token.cancel,
    };
  },
});
