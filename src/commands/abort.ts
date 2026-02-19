import type { Command } from '../components/Terminal/types';

type AbortCommandContext = {
  readonly abortMission: () => void;
  readonly isMissionActive: () => boolean;
  readonly popAllSessions: () => void;
};

export const createAbortCommand = (context: AbortCommandContext): Command => ({
  name: 'abort',
  description: 'Abort the current mission',
  manual: {
    synopsis: 'abort()',
    description:
      'Abort the current active mission. Returns you to localhost and clears all mission data including generated machines and filesystems.',
    examples: [{ command: 'abort()', description: 'Cancel the active mission' }],
  },
  fn: (): string => {
    if (!context.isMissionActive()) {
      throw new Error('No active mission to abort.');
    }
    context.popAllSessions();
    context.abortMission();
    return 'Mission aborted. All mission data cleared.';
  },
});
