import type { Command } from '../components/Terminal/types';
import { generateMissionNetwork } from '../generation/generateMission';
import type { MissionNetwork, EntryVariant } from '../generation/types';

type AcceptCommandContext = {
  readonly startMission: (mission: MissionNetwork) => void;
  readonly isMissionActive: () => boolean;
};

const formatEntryHint = (mission: MissionNetwork): string => {
  const entryIp = mission.entryPoint;
  const variant: EntryVariant = mission.entryVariant;
  const entryMachine = mission.machines.find((m) => m.ip === entryIp);
  const hostname = entryMachine?.hostname ?? entryIp;
  const guestPassword = mission.entryCredential?.password ?? 'guest';

  const entryHints: Readonly<Record<EntryVariant, string>> = {
    ssh: `> ssh("guest", "${entryIp}")  // password: ${guestPassword}`,
    ftp: `> ftp("${entryIp}")`,
    nc: `> nc("${entryIp}", 4444)`,
    exploit: `> nmap("-sV", "${entryIp}")  // scan for vulnerabilities, then exploit`,
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
  manual: {
    synopsis: 'accept(seed: string)',
    description:
      'Accept a mission contract from the darknet marketplace. The seed determines the target network — same seed always generates the same mission. Use missions() to browse available contracts and find seeds.',
    examples: [
      { command: 'accept("MEDTECH-4A7F-easy")', description: 'Accept the MedTech mission' },
    ],
  },
  fn: (seed: unknown): string => {
    if (typeof seed !== 'string' || !seed.trim()) {
      throw new Error('Usage: accept("SEED-CODE")');
    }
    if (context.isMissionActive()) {
      throw new Error('A mission is already active. Use abort() to cancel it first.');
    }
    const trimmed = seed.trim();
    const mission = generateMissionNetwork(trimmed);
    context.startMission(mission);
    return formatEntryHint(mission);
  },
});
