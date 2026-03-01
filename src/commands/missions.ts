import type { Command } from '../components/Terminal/types';
import type { MissionNetwork } from '../generation/types';
import { MISSION_BOARD, formatMissionBoard } from '../mission/missionBoard';
import { formatMissionBriefing } from './accept';

type MissionsCommandContext = {
  readonly isMissionActive: () => boolean;
  readonly getActiveMission: () => MissionNetwork | null;
};

export const createMissionsCommand = (context: MissionsCommandContext): Command => ({
  name: 'missions',
  description: 'Browse available contracts or view active mission briefing',
  manual: {
    synopsis: 'missions()',
    description:
      'Browse the darknet marketplace for available hacker-for-hire contracts. Each contract shows a client, target, objective, difficulty, and seed code. Use accept(seed) to start a mission. If a mission is already active, displays the current mission briefing.',
    examples: [
      { command: 'missions()', description: 'List available contracts or view active mission' },
    ],
  },
  fn: (): string => {
    const mission = context.getActiveMission();
    if (context.isMissionActive() && mission) {
      return formatMissionBriefing(mission);
    }
    return formatMissionBoard(MISSION_BOARD);
  },
});
