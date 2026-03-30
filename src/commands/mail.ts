import type { Command, AsyncOutput } from '../components/Terminal/types';
import type { MissionNetwork } from '../generation/types';
import type { MachineFileOp } from '../filesystem/types';
import { createCancellationToken, jitter } from '../utils/asyncCommand';
import { parseIptablesRules } from '../network/iptablesParser';
import { runScriptWithSystem } from '../utils/scriptRunner';

type MailCommandContext = {
  readonly getActiveMission: () => MissionNetwork | null;
  readonly completeMission: () => void;
  readonly readFileFromMachine: (op: MachineFileOp) => string | null;
  readonly isMachineBricked: (machine: string) => boolean;
};

const MISSION_COMPLETE_BANNER: readonly string[] = [
  '',
  '============================================',
  '  MISSION COMPLETE',
  '============================================',
];

const formatCompletionDetails = (mission: MissionNetwork): readonly string[] => [
  `  Seed: ${mission.seed}`,
  `  Difficulty: ${mission.difficulty}`,
  '',
  '  Contract fulfilled. Type missions() for more jobs.',
  '============================================',
];

const verifyExfiltrate = (proof: string, mission: MissionNetwork): string | null => {
  if (proof === mission.objective.expectedProof) return null;
  return 'Incorrect proof. Find the ACCESS-KEY in the target file.';
};

const verifyCredentialTheft = (proof: string, mission: MissionNetwork): string | null => {
  if (proof === mission.objective.expectedProof) return null;
  return 'Incorrect password. Discover the root password on the target machine.';
};

const verifyTamper = (
  mission: MissionNetwork,
  readFileFromMachine: MailCommandContext['readFileFromMachine'],
): string | null => {
  const { objective } = mission;
  const fileContent = readFileFromMachine({
    machineId: objective.targetMachine,
    path: objective.targetPath,
    cwd: '/',
    userType: 'root',
  });

  if (fileContent === null) {
    return 'Target file not found. The file may have been deleted.';
  }

  if (objective.tamperOldValue && fileContent.includes(objective.tamperOldValue)) {
    return `Target file still contains "${objective.tamperOldValue}". Modify the file first.`;
  }

  if (objective.tamperNewValue && !fileContent.includes(objective.tamperNewValue)) {
    return `Target file does not contain "${objective.tamperNewValue}". Check your edit.`;
  }

  return null;
};

const verifyScriptFix = (
  mission: MissionNetwork,
  readFileFromMachine: MailCommandContext['readFileFromMachine'],
): string | null => {
  const { objective } = mission;
  const scriptContent = readFileFromMachine({
    machineId: objective.targetMachine,
    path: objective.targetPath,
    cwd: '/',
    userType: 'root',
  });

  if (scriptContent === null) {
    return 'Script not found. The script file may have been deleted.';
  }

  // script_fix scripts are always sync (no await)
  const result = runScriptWithSystem(scriptContent);
  if (result instanceof Promise) {
    return 'Script verification error: unexpected async execution.';
  }

  if (result.error) {
    return `Script execution failed: ${result.error}`;
  }

  if (result.systemValue === null) {
    return 'Script did not call _system(). Fix the script so it produces the correct output.';
  }

  if (result.systemValue !== objective.expectedChecksum) {
    return 'Script output is incorrect. Check your fix and try again.';
  }

  return null;
};

const verifyScriptAuto = (
  mission: MissionNetwork,
  readFileFromMachine: MailCommandContext['readFileFromMachine'],
): string | null => {
  const { objective } = mission;
  const scriptContent = readFileFromMachine({
    machineId: objective.targetMachine,
    path: objective.targetPath,
    cwd: '/',
    userType: 'root',
  });

  if (scriptContent === null) {
    return 'Script not found. The script file may have been deleted.';
  }

  // Build mock data access for the script runner.
  // Local: cat() returns the data file content from the target machine.
  // Remote: curl() returns an array where the last element is the API response JSON.
  const extraContext: Record<string, (...args: readonly unknown[]) => unknown> = {};

  if (objective.scriptAutoFlavor === 'local' && objective.scriptAutoDataPath) {
    const dataContent = readFileFromMachine({
      machineId: objective.targetMachine,
      path: objective.scriptAutoDataPath,
      cwd: '/',
      userType: 'root',
    });
    extraContext.cat = () => dataContent ?? '';
  }

  if (objective.scriptAutoFlavor === 'remote' && objective.scriptAutoDataContent) {
    extraContext.curl = () => [objective.scriptAutoDataContent];
  }

  // Strip `await` — mock functions are synchronous, so the script runs in sync mode
  const syncScript = scriptContent.replace(/\bawait\s+/g, '');
  const result = runScriptWithSystem(syncScript, extraContext);

  // runScriptWithSystem is sync here (we stripped await)
  if (result instanceof Promise) {
    return 'Script verification error: unexpected async execution.';
  }

  const { systemValue, error } = result;

  if (error) {
    return `Script execution failed: ${error}`;
  }

  if (systemValue === null) {
    return 'Script did not call _system(). Follow the instructions to produce the correct output.';
  }

  if (systemValue !== objective.expectedChecksum) {
    return 'Script output is incorrect. Check the instructions and try again.';
  }

  return null;
};

const verifySabotage = (
  mission: MissionNetwork,
  isMachineBricked: MailCommandContext['isMachineBricked'],
): string | null => {
  if (isMachineBricked(mission.objective.targetMachine)) return null;
  return 'Target machine is still operational. Delete critical boot files and reboot it.';
};

const verifyBackdoor = (
  mission: MissionNetwork,
  readFileFromMachine: MailCommandContext['readFileFromMachine'],
): string | null => {
  const { objective } = mission;
  const port = objective.backdoorPort;
  if (port === undefined) return 'Invalid backdoor mission configuration.';

  const pidPath = `/var/run/nc-${port}.pid`;
  const pidContent = readFileFromMachine({
    machineId: objective.targetMachine,
    path: pidPath,
    cwd: '/',
    userType: 'root',
  });

  if (!pidContent) {
    return `No listener detected on port ${port}. Run nc("-l", ${port}) on the target machine.`;
  }

  if (objective.backdoorUser) {
    const userTypeMatch = pidContent.match(/userType=(\w+)/);
    const actualUserType = userTypeMatch?.[1];
    if (actualUserType !== objective.backdoorUser) {
      return `Backdoor must be opened as ${objective.backdoorUser}. Currently opened as ${actualUserType}.`;
    }
  }

  return null;
};

const verifyPortforward = (
  mission: MissionNetwork,
  readFileFromMachine: MailCommandContext['readFileFromMachine'],
): string | null => {
  const { objective } = mission;
  const publicPort = objective.forwardPublicPort;
  const internalIp = objective.forwardInternalIp;
  const internalPort = objective.forwardInternalPort;

  if (publicPort === undefined || !internalIp || internalPort === undefined) {
    return 'Invalid portforward mission configuration.';
  }

  const iptablesContent = readFileFromMachine({
    machineId: mission.routerPublicIp,
    path: '/etc/iptables/rules.v4',
    cwd: '/',
    userType: 'root',
  });

  if (!iptablesContent) {
    return 'Cannot read iptables rules on the router. Edit /etc/iptables/rules.v4 on the router.';
  }

  const rules = parseIptablesRules(iptablesContent);
  const match = rules.some(
    (r) =>
      r.publicPort === publicPort && r.internalIp === internalIp && r.internalPort === internalPort,
  );

  if (!match) {
    return `No matching forwarding rule found. Add: forward ${publicPort} to ${internalIp}:${internalPort}`;
  }

  return null;
};

const verifyForensics = (proof: string, mission: MissionNetwork): string | null => {
  const { attackerHandle, attackerIp } = mission.objective;
  if (!attackerHandle || !attackerIp) return 'Invalid forensics mission configuration.';

  // Split on common separators: space, comma, colon, hyphen
  const parts = proof.split(/[\s,:-]+/).filter(Boolean);
  if (parts.length < 2) {
    return 'Send both the attacker alias and their origin IP.';
  }

  const expectedParts = new Set([attackerHandle.toLowerCase(), attackerIp.toLowerCase()]);
  const providedParts = new Set(parts.map((p) => p.toLowerCase()));

  const allMatch = [...expectedParts].every((e) => providedParts.has(e));
  if (!allMatch) {
    return 'Incorrect findings. Identify the attacker alias and their origin IP from the logs.';
  }

  return null;
};

const verifyMalware = (
  mission: MissionNetwork,
  readFileFromMachine: MailCommandContext['readFileFromMachine'],
): string | null => {
  const { objective } = mission;

  // Check malware file has been deleted
  const malwareContent = readFileFromMachine({
    machineId: objective.targetMachine,
    path: objective.targetPath,
    cwd: '/',
    userType: 'root',
  });
  if (malwareContent !== null) {
    return `Malware is still on disk at ${objective.targetPath}. Find and delete it.`;
  }

  // Check PID file has been deleted (process killed)
  if (objective.malwarePidPath) {
    const pidContent = readFileFromMachine({
      machineId: objective.targetMachine,
      path: objective.malwarePidPath,
      cwd: '/',
      userType: 'root',
    });
    if (pidContent !== null) {
      return 'Malware process is still running. Use ps() to find it and kill() to stop it.';
    }
  }

  return null;
};

const verifyProof = (
  proof: string,
  mission: MissionNetwork,
  readFileFromMachine: MailCommandContext['readFileFromMachine'],
  isMachineBricked: MailCommandContext['isMachineBricked'],
): string | null => {
  const { type } = mission.objective;
  if (type === 'exfiltrate') return verifyExfiltrate(proof, mission);
  if (type === 'credential_theft') return verifyCredentialTheft(proof, mission);
  if (type === 'tamper') return verifyTamper(mission, readFileFromMachine);
  if (type === 'script_fix') return verifyScriptFix(mission, readFileFromMachine);
  if (type === 'script_auto') return verifyScriptAuto(mission, readFileFromMachine);
  if (type === 'sabotage') return verifySabotage(mission, isMachineBricked);
  if (type === 'backdoor') return verifyBackdoor(mission, readFileFromMachine);
  if (type === 'portforward') return verifyPortforward(mission, readFileFromMachine);
  if (type === 'forensics') return verifyForensics(proof, mission);
  if (type === 'malware') return verifyMalware(mission, readFileFromMachine);
  return null;
};

export const createMailCommand = (context: MailCommandContext): Command => ({
  name: 'mail',
  category: 'mission',
  description: 'Send proof to a darknet client to complete a mission',
  manual: {
    synopsis: 'mail(recipient[, content])',
    description:
      'Send a message to a darknet client. Used to submit mission proof and complete contracts. The recipient must match the client email shown in the mission briefing. Content is optional for missions that verify by inspecting machine state.',
    arguments: [
      { name: 'recipient', description: 'Client email address (e.g., "handle@darkmail.onion")' },
      {
        name: 'content',
        description:
          'Proof content (ACCESS-KEY, password, or confirmation). Optional for script_fix, tamper, sabotage, backdoor, portforward, and malware missions.',
      },
    ],
    examples: [
      {
        command: 'mail("xR0gu3x@darkmail.onion", "ACCESS-A1B2-C3D4-E5F6")',
        description: 'Submit an exfiltrated access key',
      },
      {
        command: 'mail("gh0st_@darkmail.onion", "s3cr3tP4ss")',
        description: 'Submit a stolen password',
      },
      {
        command: 'mail("cyph3rpunk@darkmail.onion", "done")',
        description: 'Confirm a tamper mission',
      },
    ],
  },
  fn: (recipient: unknown, content: unknown): AsyncOutput => {
    if (typeof recipient !== 'string' || !recipient.trim()) {
      throw new Error('mail: missing recipient\nUsage: mail("recipient@darkmail.onion", "proof")');
    }
    const mission = context.getActiveMission();

    // Content is optional for objectives that verify by inspecting machine state
    const contentOptional =
      mission?.objective.type === 'script_fix' ||
      mission?.objective.type === 'script_auto' ||
      mission?.objective.type === 'tamper' ||
      mission?.objective.type === 'sabotage' ||
      mission?.objective.type === 'backdoor' ||
      mission?.objective.type === 'portforward';

    if (typeof content !== 'string' && !contentOptional) {
      throw new Error('mail: missing content\nUsage: mail("recipient@darkmail.onion", "proof")');
    }

    if (!mission) {
      throw new Error('No active mission. Use accept("SEED") to start one.');
    }

    const trimmedRecipient = recipient.trim();
    if (trimmedRecipient !== mission.clientEmail) {
      throw new Error(
        `mail: unknown recipient "${trimmedRecipient}". Check the mission briefing for the correct email.`,
      );
    }

    const proof = typeof content === 'string' ? content.trim() : '';

    // Verify proof synchronously so errors throw immediately
    const error = verifyProof(
      proof,
      mission,
      context.readFileFromMachine,
      context.isMachineBricked,
    );
    if (error) {
      throw new Error(`mail: delivery failed — ${error}`);
    }

    const token = createCancellationToken();

    return {
      __type: 'async',
      start: (onLine, onComplete) => {
        onLine(`Connecting to darkmail.onion...`);

        let delay = jitter(600);

        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine(`Encrypting message for ${trimmedRecipient}...`);
        }, delay);

        delay += jitter(800);
        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine('Routing through onion network...');
        }, delay);

        delay += jitter(1000);
        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine('Message delivered.');

          context.completeMission();

          MISSION_COMPLETE_BANNER.forEach((line) => onLine(line));
          formatCompletionDetails(mission).forEach((line) => onLine(line));

          onComplete();
        }, delay);
      },
      cancel: token.cancel,
    };
  },
});
