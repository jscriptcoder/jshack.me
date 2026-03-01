import type { Command } from '../components/Terminal/types';
import { stringify } from '../utils/stringify';

export const echoCommand: Command = {
  name: 'echo',
  description: 'Output the given value as a string',
  manual: {
    synopsis: 'echo(value)',
    description:
      'Output the given value as a string. Objects and arrays are pretty-printed as JSON.',
    arguments: [
      {
        name: 'value',
        description: 'The value to output (string, number, boolean, object, or array)',
        required: true,
      },
    ],
    examples: [
      { command: 'echo("Hello World")', description: 'Output a string' },
      { command: 'echo(42)', description: 'Output a number' },
      { command: 'echo({name: "test"})', description: 'Output an object as formatted JSON' },
      { command: 'const msg = "Hi"; echo(msg)', description: 'Output a variable value' },
    ],
  },
  fn: (...args: unknown[]): string => stringify(args[0]),
};
