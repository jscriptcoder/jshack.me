import type { Command, AsyncOutput } from '../components/Terminal/types';
import { clearAllData } from '../utils/storage';

type ResetContext = {
  readonly getDatabase: () => IDBDatabase | null;
  // Server-side wipe of THIS player's patches on machines they own
  // (currently `machine_id = 'localhost'`). Optional — older test setups
  // omit it; production wires it via the patchRegistry client. The
  // wrapper's rejection is swallowed and logged, but the reload waits
  // for it to settle so an in-flight DELETE isn't aborted by the
  // page navigation.
  readonly clearOwnedPatches?: () => Promise<void>;
};

const RELOAD_DELAY_MS = 500;

const WARNING_MESSAGE =
  '⚠ This will wipe ALL progress and return to the start screen.\n' +
  'Type reset("confirm") to proceed.';

export const createResetCommand = (context: ResetContext): Command => ({
  name: 'reset',
  category: 'general',
  description: 'Wipe all progress and return to the start screen',
  manual: {
    synopsis: 'reset [confirm]',
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
      { command: 'reset', description: 'Show reset warning' },
      { command: 'reset confirm', description: 'Reset game and reload page' },
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

        // Server-side wipe — fired in parallel with the local clear,
        // BUT the reload waits for it to settle. Otherwise the page
        // navigation aborts the in-flight DELETE and leaves rows
        // server-side. Best-effort: a rejection is logged, the reload
        // still happens.
        const serverPromise = context.clearOwnedPatches
          ? context.clearOwnedPatches().catch((error) => {
              console.error('[reset] clearOwnedPatches failed:', error);
            })
          : Promise.resolve();

        const localPromise = db
          ? clearAllData(db).catch((error) => {
              console.error('[reset] clearAllData failed:', error);
            })
          : Promise.resolve();

        // Emit the no-DB line synchronously; the with-DB line waits
        // until clearAllData completes (matches existing UX timing).
        if (!db) {
          onLine('No database connection. Reloading...');
        }

        void Promise.all([localPromise, serverPromise]).then(() => {
          if (db) {
            onLine('Game reset. Reloading...');
          }
          setTimeout(() => {
            window.location.reload();
            onComplete();
          }, RELOAD_DELAY_MS);
        });
      },
    };
  },
});
