import type { Command } from '../components/Terminal/types';
import { generateMissionNetwork } from '../generation/generateMission';
import type { MissionNetwork, EntryVariant } from '../generation/types';

type AcceptCommandContext = {
  readonly startMission: (mission: MissionNetwork) => void;
  readonly isMissionActive: () => boolean;
};

export const formatObjectiveHint = (mission: MissionNetwork): string => {
  const { objective } = mission;
  const email = mission.clientEmail;

  if (objective.type === 'exfiltrate') {
    return [
      '  Find the ACCESS-KEY in the target file and mail it to the client.',
      `  Example: mail("${email}", "ACCESS-XXXX-XXXX-XXXX")`,
    ].join('\n');
  }

  if (objective.type === 'tamper') {
    return [
      `  Modify the target file: change "${objective.tamperOldValue}" to "${objective.tamperNewValue}".`,
      `  Then confirm by mailing the client.`,
      `  Example: mail("${email}", "done")`,
    ].join('\n');
  }

  // credential_theft
  return [
    '  Discover the root password on the target machine and mail it to the client.',
    `  Example: mail("${email}", "<password>")`,
  ].join('\n');
};

export const formatMissionBriefing = (mission: MissionNetwork): string => {
  const publicIp = mission.routerPublicIp;
  const routerHostname = mission.routerMachine.hostname;
  const variant: EntryVariant = mission.entryVariant;
  const guestPassword = mission.entryCredential?.password ?? 'guest';
  const isForwarded = mission.natForwarding !== undefined;

  const entryHints: Readonly<Record<EntryVariant, string>> = {
    ssh: `> ssh("guest", "${publicIp}")  // password: ${guestPassword}`,
    ftp: `> ftp("${publicIp}")`,
    nc: `> nc("${publicIp}", 4444)`,
    exploit: `> nmap("-sV", "${publicIp}")  // scan for vulnerabilities, then exploit`,
  };

  const modeHint = isForwarded
    ? '  Port forwarding detected — connections route to internal DMZ.'
    : '  No forwarding — hack the router to reach the internal network.';

  return [
    '============================================',
    '  MISSION BRIEFING',
    '============================================',
    '',
    `  Seed: ${mission.seed}`,
    `  Difficulty: ${mission.difficulty}`,
    `  Objective: ${mission.objective.description}`,
    `  Reply to: ${mission.clientEmail}`,
    '',
    formatObjectiveHint(mission),
    '',
    `  Gateway: ${routerHostname} (${publicIp})`,
    modeHint,
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
    return formatMissionBriefing(mission);
  },
});
