import type { Command } from '../components/Terminal/types';
import { generateMissionNetwork } from '../generation/generateMission';
import type { MissionNetwork, EntryVariant } from '../generation/types';

type AcceptCommandContext = {
  readonly startMission: (seed: string) => void;
  readonly isMissionActive: () => boolean;
};

const formatEntryHint = (mission: MissionNetwork): string => {
  const entryIp = mission.entryPoint;
  const variant: EntryVariant = mission.entryVariant;
  const entryMachine = mission.machines.find((m) => m.ip === entryIp);
  const hostname = entryMachine?.hostname ?? entryIp;

  const entryHints: Readonly<Record<EntryVariant, string>> = {
    ssh: `> ssh("guest", "${entryIp}")`,
    ftp: `> ftp("${entryIp}")`,
    nc: `> nc("${entryIp}", 4444)`,
  };

  return [
    '============================================',
    '  MISSION BRIEFING',
    '============================================',
    '',
    `  Seed: ${mission.seed}`,
    `  Difficulty: ${mission.difficulty}`,
    `  Objective: ${mission.objective.description}`,
    '',
    `  Entry point: ${hostname} (${entryIp})`,
    `  Access: ${entryHints[variant]}`,
    '',
    '  Use nmap() to scan the target network.',
    '  Use abort() to cancel the mission.',
    '============================================',
  ].join('\n');
};

export const createAcceptCommand = (context: AcceptCommandContext): Command => ({
  name: 'accept',
  description: 'Accept a mission contract',
  fn: (seed: unknown): string => {
    if (typeof seed !== 'string' || !seed.trim()) {
      throw new Error('Usage: accept("SEED-CODE")');
    }
    if (context.isMissionActive()) {
      throw new Error('A mission is already active. Use abort() to cancel it first.');
    }
    const trimmed = seed.trim();
    const mission = generateMissionNetwork(trimmed);
    context.startMission(trimmed);
    return formatEntryHint(mission);
  },
});
