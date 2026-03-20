import type { Command, AsyncOutput } from '../components/Terminal/types';
import { clearAllData } from '../utils/storage';

type ResetContext = {
  readonly getDatabase: () => IDBDatabase | null;
};

const RELOAD_DELAY_MS = 500;

const WARNING_MESSAGE =
  'This will wipe ALL progress and return to the start screen.\n' +
  'Type reset("confirm") to proceed.';

export const createResetCommand = (context: ResetContext): Command => ({
  name: 'reset',
  category: 'general',
  description: 'Wipe all progress and return to the start screen',
  manual: {
    synopsis: 'reset(["confirm"])',
    description:
      'Wipe all game progress and return to the start screen. ' +
      'Clears session, filesystem changes, mission state, and game seed. ' +
      'You will choose a new workstation name and get fresh WiFi networks. ' +
      'Requires passing "confirm" to prevent accidental resets.',
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
