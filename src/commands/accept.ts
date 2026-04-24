import type { AsyncOutput, Command } from '../components/Terminal/types';
import { generateMissionNetwork } from '../generation/generateMission';
import type { MissionNetwork } from '../generation/types';

type AcceptCommandContext = {
  readonly startMission: (mission: MissionNetwork) => void;
  readonly isMissionActive: () => boolean;
  readonly getUsedPublicIps?: () => ReadonlySet<string>;
};

export const formatObjectiveHint = (mission: MissionNetwork): string => {
  const { objective } = mission;
  const email = mission.clientEmail;

  if (objective.type === 'exfiltrate' && objective.encrypted) {
    return [
      '  Find the encrypted target file and the decryption key.',
      "  You'll need root access to use gpg. The key is on another machine.",
      `  Example: mail ${email} ACCESS-XXXX-XXXX-XXXX`,
    ].join('\n');
  }

  if (objective.type === 'exfiltrate') {
    return [
      '  Find the ACCESS-KEY in the target file and mail it to the client.',
      `  Example: mail ${email} ACCESS-XXXX-XXXX-XXXX`,
    ].join('\n');
  }

  if (objective.type === 'tamper') {
    return [
      `  Modify the target file: change "${objective.tamperOldValue}" to "${objective.tamperNewValue}".`,
      `  Then confirm by mailing the client.`,
      `  Example: mail ${email} done`,
    ].join('\n');
  }

  if (objective.type === 'script_fix') {
    const lines = [
      '  Find the broken script on the target machine. Fix it with nano',
      '  and test it with node. When fixed, confirm to the client.',
      `  Example: mail ${email} done`,
    ];
    if (objective.scriptBugType === 'corrupted') {
      lines.push('  Look around the machine for the correct values.');
    }
    return lines.join('\n');
  }

  if (objective.type === 'script_auto') {
    return [
      '  Write the automated script on the target machine. Follow the instructions',
      '  in the stub file, then test it with node. When working, confirm to the client.',
      `  Example: mail ${email} done`,
    ].join('\n');
  }

  if (objective.type === 'sabotage') {
    return [
      '  Destroy the target machine. Delete critical boot files and reboot it.',
      '  Then confirm the kill to the client.',
      `  Example: mail ${email} done`,
    ].join('\n');
  }

  if (objective.type === 'backdoor') {
    const port = objective.backdoorPort ?? 0;
    const userHint =
      objective.backdoorUser === 'root'
        ? ' as root'
        : objective.backdoorUser === 'guest'
          ? ' as guest'
          : '';
    return [
      `  Open a backdoor listener on port ${port}${userHint} on the target machine.`,
      `  Install netcat and run nc -l ${port}. Then confirm to the client.`,
      `  Example: mail ${email} done`,
    ].join('\n');
  }

  if (objective.type === 'portforward') {
    return [
      '  Hack the border router and set up NAT port forwarding.',
      '  Then confirm to the client.',
      `  Example: mail ${email} done`,
    ].join('\n');
  }

  if (objective.type === 'forensics') {
    return [
      '  Investigate the breach. Search the logs across machines to trace the',
      "  attacker's path. Find their alias and origin IP.",
      `  Example: mail ${email} "<alias> <ip>"`,
    ].join('\n');
  }

  if (objective.type === 'malware') {
    return [
      '  Find the malware, kill the process, and delete the malicious file',
      '  to prevent re-execution.',
      `  Example: mail ${email} done`,
    ].join('\n');
  }

  if (objective.type === 'db_exfiltrate') {
    return [
      '  Extract the secret access key from the database on the target machine.',
      `  Example: mail ${email} ACCESS-XXXX-XXXX-XXXX`,
    ].join('\n');
  }

  if (objective.type === 'db_tamper') {
    const rowCtx = objective.dbTamperRowHint ? `${objective.dbTamperRowHint} ` : '';
    return [
      `  Modify the database: change ${rowCtx}value from "${objective.dbTamperOldValue}" to "${objective.dbTamperNewValue}"`,
      `  in the ${objective.dbTargetTable} table. Then confirm to the client.`,
      `  Example: mail ${email} done`,
    ].join('\n');
  }

  if (objective.type === 'db_sabotage') {
    return [
      `  Destroy the ${objective.dbTargetTable} table in the database on the target machine.`,
      `  Example: mail ${email} done`,
    ].join('\n');
  }

  if (objective.type === 'db_fix') {
    const rowCtx = objective.dbTamperRowHint ? `${objective.dbTamperRowHint} ` : '';
    return [
      `  A deployment corrupted database records. Restore ${rowCtx}value from`,
      `  "${objective.dbTamperOldValue}" to "${objective.dbTamperNewValue}" in the ${objective.dbTargetTable} table.`,
      `  Example: mail ${email} done`,
    ].join('\n');
  }

  // credential_theft
  return [
    '  Discover the root password on the target machine and mail it to the client.',
    `  Example: mail ${email} <password>`,
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
    `  Target: ${target}`,
    '',
    '  Use abort to cancel the mission.',
    '============================================',
  ].join('\n');
};

export const createAcceptCommand = (context: AcceptCommandContext): Command => ({
  name: 'accept',
  category: 'mission',
  description: 'Accept a mission contract',
  manual: {
    synopsis: 'accept <seed>',
    description:
      'Accept a mission contract from the darknet marketplace. The seed determines the target network — same seed always generates the same mission. Use missions to browse available contracts and find seeds.',
    examples: [{ command: 'accept MY-SEED-easy', description: 'Accept a mission with this seed' }],
  },
  fn: (seed: unknown): AsyncOutput => {
    if (typeof seed !== 'string' || !seed.trim()) {
      throw new Error('accept: missing seed\nUsage: accept <SEED-CODE>');
    }
    if (context.isMissionActive()) {
      throw new Error('A mission is already active. Use abort to cancel it first.');
    }
    const trimmed = seed.trim();

    // Wrap the async generation in an AsyncOutput — terminal supports these
    // for commands that yield results off the main sync pipeline. Generation
    // is near-instant in single-player today; in Phase 5 there's a server
    // round-trip for IP allocation inside generateMissionNetwork, which is
    // why this whole command chain is async now.
    return {
      __type: 'async',
      start: (onLine, onComplete) => {
        generateMissionNetwork(trimmed, context.getUsedPublicIps?.())
          .then((mission) => {
            context.startMission(mission);
            formatMissionBriefing(mission)
              .split('\n')
              .forEach((line) => onLine(line));
            onComplete();
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : 'failed to generate mission';
            onLine(`accept: ${message}`);
            onComplete();
          });
      },
    };
  },
});
