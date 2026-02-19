import type { Command } from '../components/Terminal/types';
import { MISSION_BOARD, formatMissionBoard } from '../mission/missionBoard';

type MissionsCommandContext = {
  readonly isMissionActive: () => boolean;
};

export const createMissionsCommand = (context: MissionsCommandContext): Command => ({
  name: 'missions',
  description: 'Browse available hacker-for-hire contracts',
  fn: (): string => {
    if (context.isMissionActive()) {
      throw new Error('Cannot browse missions while a mission is active. Use abort() first.');
    }
    return formatMissionBoard(MISSION_BOARD);
  },
});
