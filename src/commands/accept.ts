import type { Command } from '../components/Terminal/types';
import { generateMissionNetwork } from '../generation/generateMission';
import type { MissionNetwork } from '../generation/types';

type AcceptCommandContext = {
  readonly startMission: (mission: MissionNetwork) => void;
  readonly isMissionActive: () => boolean;
};

export const formatObjectiveHint = (mission: MissionNetwork): string => {
  const { objective } = mission;
  const email = mission.clientEmail;

  if (objective.type === 'exfiltrate' && objective.encrypted) {
    return [
      '  Find the encrypted target file and the decryption key.',
      "  You'll need root access to use decrypt(). The key is on another machine.",
      `  Example: mail("${email}", "ACCESS-XXXX-XXXX-XXXX")`,
    ].join('\n');
  }

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

  if (objective.type === 'script_fix') {
    const lines = [
      '  Find the broken script on the target machine. Fix it with nano()',
      '  and run it with node(). The script will output an ACCESS-KEY if fixed correctly.',
      `  Mail the code to the client to complete the mission.`,
      `  Example: mail("${email}", "<code>")`,
    ];
    if (objective.scriptBugType === 'corrupted') {
      lines.push('  Look around the machine for the correct values.');
    }
    return lines.join('\n');
  }

  // credential_theft
  return [
    '  Discover the root password on the target machine and mail it to the client.',
    `  Example: mail("${email}", "<password>")`,
  ].join('\n');
};

// Generates variant-specific "Intel:" text for the mission briefing.
// No command names appear — hints use natural language so the player
// must figure out which tools to use.
export const formatEntryHint = (mission: MissionNetwork): string => {
  const target = mission.domainEntry ? mission.routerDomain : mission.routerPublicIp;
  const domainSuffix = mission.domainEntry ? ' Resolve the target domain first.' : '';

  if (mission.entryVariant === 'ssh') {
    if (mission.briefingRevealsCredentials && mission.entryCredential) {
      const { username, password } = mission.entryCredential;
      const sshLine = mission.domainEntry
        ? `  SSH access available — ${username}:${password}`
        : `  SSH access available — ssh("${username}", "${target}") — password: ${password}`;
      return (
        [`  Intel:`, sshLine].join('\n') + (mission.domainEntry ? `\n  ${domainSuffix.trim()}` : '')
      );
    }
    return [
      `  Intel:`,
      '  Our intel suggests default credentials may still be active on the target.',
      '  Try common accounts.' + domainSuffix,
    ].join('\n');
  }

  if (mission.entryVariant === 'ftp') {
    return [
      `  Intel:`,
      '  Our recon shows an FTP service running on the target.' + domainSuffix,
      '  Explore it for useful credentials.',
    ].join('\n');
  }

  if (mission.entryVariant === 'nc') {
    return [
      `  Intel:`,
      '  Our scanner picked up a suspicious backdoor service.' + domainSuffix,
      '  Run a port scan to find it.',
    ].join('\n');
  }

  if (mission.entryVariant === 'exploit') {
    return [
      `  Intel:`,
      '  The target is running outdated software with known vulnerabilities.' + domainSuffix,
      '  A thorough scan should reveal the weak point.',
    ].join('\n');
  }

  // http variant
  return [
    `  Intel:`,
    "  There's a web server running on the target." + domainSuffix,
    "  Check what it's serving — credentials might be leaking.",
  ].join('\n');
};

export const formatMissionBriefing = (mission: MissionNetwork): string => {
  const target = mission.domainEntry ? mission.routerDomain : mission.routerPublicIp;

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
    formatEntryHint(mission),
    '',
    `  Target: ${target}`,
    '',
    '  Use abort() to cancel the mission.',
    '============================================',
  ].join('\n');
};

export const createAcceptCommand = (context: AcceptCommandContext): Command => ({
  name: 'accept',
  description: 'Accept a mission contract',
  manual: {
    synopsis: 'accept(seed)',
    description:
      'Accept a mission contract from the darknet marketplace. The seed determines the target network — same seed always generates the same mission. Use missions() to browse available contracts and find seeds.',
    examples: [
      { command: 'accept("MY-SEED-easy")', description: 'Accept a mission with this seed' },
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
