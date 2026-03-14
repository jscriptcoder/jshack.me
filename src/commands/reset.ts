import type { Command, AsyncOutput } from '../components/Terminal/types';
import { clearAllData } from '../utils/storage';

type ResetContext = {
  readonly getDatabase: () => IDBDatabase | null;
};

const RELOAD_DELAY_MS = 500;

const WARNING_MESSAGE =
  '⚠ This will reset ALL game progress (session, filesystem changes).\n' +
  'Type reset("confirm") to proceed.';

export const createResetCommand = (context: ResetContext): Command => ({
  name: 'reset',
  category: 'general',
  description: 'Reset game to factory defaults (clears all saved progress)',
  manual: {
    synopsis: 'reset(["confirm"])',
    description:
      'Reset the game to factory defaults by clearing all saved state from IndexedDB. ' +
      'This removes session data (current user, machine, path) and all filesystem changes ' +
      '(files created or modified during gameplay). The page reloads after clearing. ' +
      'Requires passing "confirm" as argument to prevent accidental resets.',
    arguments: [
      {
        name: 'confirm',
        description: 'Pass the string "confirm" to execute the reset',
        required: true,
      },
    ],
    examples: [
      { command: 'reset()', description: 'Show reset warning' },
      { command: 'reset("confirm")', description: 'Reset game and reload page' },
    ],
  },
  fn: (...args: unknown[]): string | AsyncOutput => {
    if (args[0] !== 'confirm') {
      return WARNING_MESSAGE;
    }

    return {
      __type: 'async',
      start: (onLine, onComplete) => {
        const db = context.getDatabase();

        const reloadAfterDelay = () => {
          onLine('Game reset. Reloading...');
          setTimeout(() => {
            window.location.reload();
            onComplete();
          }, RELOAD_DELAY_MS);
        };

        if (!db) {
          onLine('No database connection. Reloading...');
          setTimeout(() => {
            window.location.reload();
            onComplete();
          }, RELOAD_DELAY_MS);
          return;
        }

        clearAllData(db).then(reloadAfterDelay).catch(reloadAfterDelay);
      },
    };
  },
});
