import type { Command, AsyncOutput } from '../components/Terminal/types';
import type { MissionNetwork } from '../generation/types';
import type { UserType } from '../session/SessionContext';
import { createCancellationToken } from '../utils/asyncCommand';

type MailCommandContext = {
  readonly getActiveMission: () => MissionNetwork | null;
  readonly completeMission: () => void;
  readonly readFileFromMachine: (
    machineId: string,
    path: string,
    cwd: string,
    userType: UserType,
  ) => string | null;
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
  const fileContent = readFileFromMachine(
    objective.targetMachine,
    objective.targetPath,
    '/',
    'root',
  );

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

const verifyProof = (
  proof: string,
  mission: MissionNetwork,
  readFileFromMachine: MailCommandContext['readFileFromMachine'],
): string | null => {
  const { type } = mission.objective;
  if (type === 'exfiltrate') return verifyExfiltrate(proof, mission);
  if (type === 'credential_theft') return verifyCredentialTheft(proof, mission);
  if (type === 'tamper') return verifyTamper(mission, readFileFromMachine);
  return null;
};

export const createMailCommand = (context: MailCommandContext): Command => ({
  name: 'mail',
  description: 'Send proof to a darknet client to complete a mission',
  manual: {
    synopsis: 'mail(recipient: string, content: string)',
    description:
      'Send a message to a darknet client. Used to submit mission proof and complete contracts. The recipient must match the client email shown in the mission briefing.',
    arguments: [
      { name: 'recipient', description: 'Client email address (e.g., "handle@darkmail.onion")' },
      { name: 'content', description: 'Proof content (ACCESS-KEY, password, or confirmation)' },
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
      throw new Error('Usage: mail("recipient@darkmail.onion", "proof")');
    }
    if (typeof content !== 'string') {
      throw new Error('Usage: mail("recipient@darkmail.onion", "proof")');
    }

    const mission = context.getActiveMission();
    if (!mission) {
      throw new Error('No active mission. Use accept("SEED") to start one.');
    }

    const trimmedRecipient = recipient.trim();
    if (trimmedRecipient !== mission.clientEmail) {
      throw new Error(
        `mail: unknown recipient "${trimmedRecipient}". Check the mission briefing for the correct email.`,
      );
    }

    const proof = content.trim();

    // Verify proof synchronously so errors throw immediately
    const error = verifyProof(proof, mission, context.readFileFromMachine);
    if (error) {
      throw new Error(`mail: delivery failed — ${error}`);
    }

    const token = createCancellationToken();

    return {
      __type: 'async',
      start: (onLine, onComplete) => {
        onLine(`Connecting to darkmail.onion...`);

        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine(`Encrypting message for ${trimmedRecipient}...`);
        }, 600);

        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine('Routing through onion network...');
        }, 1400);

        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine('Message delivered.');

          context.completeMission();

          MISSION_COMPLETE_BANNER.forEach((line) => onLine(line));
          formatCompletionDetails(mission).forEach((line) => onLine(line));

          onComplete();
        }, 2400);
      },
      cancel: token.cancel,
    };
  },
});
