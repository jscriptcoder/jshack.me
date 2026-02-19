import type { Prng } from './prng';
import type {
  AttackMethod,
  AttackStep,
  CredentialMap,
  CredentialPlacement,
  Difficulty,
  GeneratedMachine,
  MissionObjective,
} from './types';

type AttackChainInput = {
  readonly prng: Prng;
  readonly machines: readonly GeneratedMachine[];
  readonly credentials: CredentialMap;
  readonly entryPoint: string;
  readonly difficulty: Difficulty;
};

type AttackChainResult = {
  readonly attackChain: readonly AttackStep[];
  readonly credentialPlacements: readonly CredentialPlacement[];
  readonly objective: MissionObjective;
};

const hintTemplates: readonly string[] = [
  'Check auth.log on {{machine}} for login attempts',
  'Look in /etc/{{service}}.conf on {{machine}} for hardcoded credentials',
  'The user {{user}} left credentials in their .bash_history on {{machine}}',
  'A backup file on {{machine}} contains plaintext passwords',
  "Check {{user}}'s home directory on {{machine}} for notes",
];

const placementTemplates: readonly {
  readonly path: string;
  readonly template: string;
}[] = [
  {
    path: '/var/log/auth.log',
    template:
      'Jan 15 03:22:14 {{hostname}} sshd[1842]: Accepted password for {{user}} from {{ip}} port 52413\nJan 15 03:22:14 {{hostname}} sshd[1842]: pam_unix(sshd:session): session opened for user {{user}}\n# Password hint: {{password}}',
  },
  {
    path: '/home/{{localUser}}/.bash_history',
    template:
      'ssh {{user}}@{{ip}}\ncat /etc/passwd\nsudo -l\n# tried: {{password}}\nssh -o StrictHostKeyChecking=no {{user}}@{{ip}}',
  },
  {
    path: '/tmp/backup_credentials.txt',
    template:
      'Backup Credentials (DO NOT SHARE)\n================================\nServer: {{ip}}\nUser: {{user}}\nPass: {{password}}\nLast rotated: never',
  },
  {
    path: '/home/{{localUser}}/notes.txt',
    template:
      'Server access notes:\n- {{hostname}} ({{ip}}): {{user}} / {{password}}\n- Remember to rotate these!',
  },
  {
    path: '/etc/maintenance.conf',
    template:
      '[remote_backup]\nhost={{ip}}\nuser={{user}}\npassword={{password}}\nschedule=daily\npath=/var/backups',
  },
];

const getMethodForMachine = (machine: GeneratedMachine): AttackMethod => {
  const hasFtp = machine.remoteMachine.ports.some((p) => p.port === 21 && p.open);
  if (hasFtp) return 'ftp';
  return 'ssh';
};

const buildPath = (
  prng: Prng,
  machines: readonly GeneratedMachine[],
  entryPoint: string,
  difficulty: Difficulty,
): readonly GeneratedMachine[] => {
  const entry = machines.find((m) => m.ip === entryPoint);
  if (!entry) return [];

  const nonEntry = machines.filter((m) => m.ip !== entryPoint);
  if (nonEntry.length === 0) return [entry];

  const hopCount =
    difficulty === 'easy'
      ? 1
      : difficulty === 'medium'
        ? Math.min(2, nonEntry.length)
        : nonEntry.length;

  const shuffled = prng.pickN(nonEntry, hopCount);
  return [entry, ...shuffled];
};

export const generateAttackChain = (input: AttackChainInput): AttackChainResult => {
  const { prng, machines, credentials, entryPoint, difficulty } = input;

  const path = buildPath(prng, machines, entryPoint, difficulty);
  if (path.length < 2) {
    const target = path[0] ?? machines[0];
    const targetIp = target?.ip ?? entryPoint;
    const targetCreds = credentials[targetIp] ?? [];
    const rootCred = targetCreds.find((c) => c.username === 'root') ?? {
      username: 'root',
      password: 'r00tpass',
    };
    const flag = `FLAG{mission_${prng.nextInt(10000, 99999)}}`;

    return {
      attackChain: [
        {
          fromMachine: 'entry',
          toMachine: targetIp,
          method: 'su',
          credential: rootCred,
          hint: 'Escalate privileges on the entry machine',
        },
      ],
      credentialPlacements: [],
      objective: {
        type: 'find_flag',
        description: `Find the hidden flag on ${target?.hostname ?? 'target'}`,
        targetMachine: targetIp,
        targetPath: '/root/flag.txt',
        flag,
      },
    };
  }

  const flag = `FLAG{mission_${prng.nextInt(10000, 99999)}}`;
  const targetMachine = path[path.length - 1] as GeneratedMachine;

  const attackChain: AttackStep[] = [];
  const credentialPlacements: CredentialPlacement[] = [];

  for (let i = 0; i < path.length - 1; i++) {
    const fromMachine = path[i] as GeneratedMachine;
    const toMachine = path[i + 1] as GeneratedMachine;
    const method = getMethodForMachine(toMachine);

    const targetMachineCreds = credentials[toMachine.ip] ?? [];
    const nonRootCreds = targetMachineCreds.filter(
      (c) => c.username !== 'root' && c.username !== 'guest',
    );
    const credential = nonRootCreds.length > 0 ? prng.pick(nonRootCreds) : targetMachineCreds[0];

    if (!credential) continue;

    const hintTemplate = prng.pick(hintTemplates);
    const hint = hintTemplate
      .replace('{{machine}}', fromMachine.hostname)
      .replace('{{service}}', method)
      .replace('{{user}}', credential.username);

    attackChain.push({
      fromMachine: i === 0 ? 'entry' : fromMachine.ip,
      toMachine: toMachine.ip,
      method,
      credential,
      hint,
    });

    const placement = prng.pick(placementTemplates);
    const fromCreds = credentials[fromMachine.ip] ?? [];
    const localUsers = fromCreds.filter((c) => c.username !== 'root' && c.username !== 'guest');
    const localUser = localUsers.length > 0 ? prng.pick(localUsers).username : 'admin';

    const filePath = placement.path.replace('{{localUser}}', localUser);
    const fileContent = placement.template
      .replace(/\{\{hostname\}\}/g, toMachine.hostname)
      .replace(/\{\{ip\}\}/g, toMachine.ip)
      .replace(/\{\{user\}\}/g, credential.username)
      .replace(/\{\{password\}\}/g, credential.password)
      .replace(/\{\{localUser\}\}/g, localUser);

    credentialPlacements.push({
      machineIp: fromMachine.ip,
      filePath,
      fileContent,
      username: credential.username,
      password: credential.password,
    });
  }

  const objectiveTypes = ['exfiltrate', 'tamper', 'find_flag'] as const;
  const objectiveType = prng.pick(objectiveTypes);

  const descriptions: Readonly<Record<typeof objectiveType, string>> = {
    exfiltrate: `Exfiltrate the secret data from ${targetMachine.hostname}`,
    tamper: `Modify the target file on ${targetMachine.hostname}`,
    find_flag: `Find the hidden flag on ${targetMachine.hostname}`,
  };

  return {
    attackChain,
    credentialPlacements,
    objective: {
      type: objectiveType,
      description: descriptions[objectiveType],
      targetMachine: targetMachine.ip,
      targetPath: '/root/flag.txt',
      flag,
    },
  };
};
