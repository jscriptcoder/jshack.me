import type { Prng } from './prng';
import type {
  AttackMethod,
  AttackStep,
  CredentialMap,
  CredentialPlacement,
  Difficulty,
  EntryVariant,
  GeneratedMachine,
  MissionObjective,
  MissionObjectiveType,
} from './types';
import { clientHandles, targetFileTemplatesByRole, tamperFileTemplatesByRole } from './pools';
import { binaryCredentialPaths, binaryHintTemplates, binaryTargetPaths } from './binary';

type AttackChainInput = {
  readonly prng: Prng;
  readonly machines: readonly GeneratedMachine[];
  readonly credentials: CredentialMap;
  readonly entryPoint: string;
  readonly entryVariant: EntryVariant;
  readonly difficulty: Difficulty;
  readonly objectiveTypeOverride?: MissionObjectiveType;
};

type AttackChainResult = {
  readonly attackChain: readonly AttackStep[];
  readonly credentialPlacements: readonly CredentialPlacement[];
  readonly objective: MissionObjective;
  readonly clientEmail: string;
};

const placementTemplates: readonly {
  readonly path: string;
  readonly template: string;
  readonly hint: string;
}[] = [
  {
    path: '/var/log/auth.log',
    template:
      'Jan 15 03:22:14 {{hostname}} sshd[1842]: Accepted password for {{user}} from {{ip}} port 52413\nJan 15 03:22:14 {{hostname}} sshd[1842]: pam_unix(sshd:session): session opened for user {{user}}\n# Password hint: {{password}}',
    hint: 'Check auth.log on {{machine}} for login attempts',
  },
  {
    path: '/home/{{localUser}}/.bash_history',
    template:
      'ssh {{user}}@{{ip}}\ncat /etc/passwd\nsudo -l\n# tried: {{password}}\nssh -o StrictHostKeyChecking=no {{user}}@{{ip}}',
    hint: 'The user {{localUser}} left credentials in their .bash_history on {{machine}}',
  },
  {
    path: '/tmp/backup_credentials.txt',
    template:
      'Backup Credentials (DO NOT SHARE)\n================================\nServer: {{ip}}\nUser: {{user}}\nPass: {{password}}\nLast rotated: never',
    hint: 'A backup file in /tmp on {{machine}} contains plaintext passwords',
  },
  {
    path: '/home/{{localUser}}/notes.txt',
    template:
      'Server access notes:\n- {{hostname}} ({{ip}}): {{user}} / {{password}}\n- Remember to rotate these!',
    hint: "Check {{localUser}}'s home directory on {{machine}} for notes",
  },
  {
    path: '/etc/maintenance.conf',
    template:
      '[remote_backup]\nhost={{ip}}\nuser={{user}}\npassword={{password}}\nschedule=daily\npath=/var/backups',
    hint: 'Look in /etc/maintenance.conf on {{machine}} for hardcoded credentials',
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

// Generates a hex access key like ACCESS-A1B2-C3D4-E5F6
const generateAccessKey = (prng: Prng): string => {
  const hex = () => prng.nextInt(0, 0xffff).toString(16).toUpperCase().padStart(4, '0');
  return `ACCESS-${hex()}-${hex()}-${hex()}`;
};

// Selects a role-appropriate target file template and fills {{access_key}} placeholder.
const selectExfiltrateFile = (
  prng: Prng,
  targetMachine: GeneratedMachine,
  credentials: CredentialMap,
  accessKey: string,
): { readonly targetPath: string; readonly targetContent: string } => {
  const templates = targetFileTemplatesByRole[targetMachine.role];
  const template = prng.pick(templates);

  const machineCreds = credentials[targetMachine.ip] ?? [];
  const regularUser =
    machineCreds.find((c) => c.username !== 'root' && c.username !== 'guest')?.username ?? 'admin';

  const targetPath = template.path.replace(/\{\{user\}\}/g, regularUser);
  const targetContent = template.contentTemplate.replace(/\{\{access_key\}\}/g, accessKey);

  return { targetPath, targetContent };
};

// Selects a role-appropriate tamper file template and fills {{tamperOldValue}} placeholder.
const selectTamperFile = (
  prng: Prng,
  targetMachine: GeneratedMachine,
): {
  readonly targetPath: string;
  readonly targetContent: string;
  readonly tamperOldValue: string;
  readonly tamperNewValue: string;
} => {
  const templates = tamperFileTemplatesByRole[targetMachine.role];
  const template = prng.pick(templates);

  const targetContent = template.contentTemplate.replace(
    /\{\{tamperOldValue\}\}/g,
    template.tamperOldValue,
  );

  return {
    targetPath: template.path,
    targetContent,
    tamperOldValue: template.tamperOldValue,
    tamperNewValue: template.tamperNewValue,
  };
};

const generateClientEmail = (prng: Prng): string => {
  const handle = prng.pick(clientHandles);
  return `${handle}@darkmail.onion`;
};

const entryVariantToMethod = (variant: EntryVariant): AttackMethod => {
  const methodMap: Readonly<Record<EntryVariant, AttackMethod>> = {
    ssh: 'ssh',
    ftp: 'ftp',
    nc: 'nc',
    exploit: 'exploit',
  };
  return methodMap[variant];
};

// Builds the objective for a given type, target machine, and credentials.
const buildObjective = (
  prng: Prng,
  objectiveType: MissionObjectiveType,
  targetMachine: GeneratedMachine,
  credentials: CredentialMap,
  clientEmail: string,
): MissionObjective => {
  if (objectiveType === 'exfiltrate') {
    const accessKey = generateAccessKey(prng);
    const { targetPath, targetContent } = selectExfiltrateFile(
      prng,
      targetMachine,
      credentials,
      accessKey,
    );

    // ~25% chance to wrap exfiltrate target in a binary file
    const isBinary = prng.next() < 0.25;
    const finalPath = isBinary ? prng.pick(binaryTargetPaths[targetMachine.role]) : targetPath;

    return {
      type: 'exfiltrate',
      description: `Exfiltrate the secret data from ${targetMachine.hostname}`,
      targetMachine: targetMachine.ip,
      targetPath: finalPath,
      targetContent,
      clientEmail,
      expectedProof: accessKey,
      binary: isBinary || undefined,
    };
  }

  if (objectiveType === 'tamper') {
    const { targetPath, targetContent, tamperOldValue, tamperNewValue } = selectTamperFile(
      prng,
      targetMachine,
    );
    return {
      type: 'tamper',
      description: `Modify the target record on ${targetMachine.hostname}`,
      targetMachine: targetMachine.ip,
      targetPath,
      targetContent,
      clientEmail,
      expectedProof: '',
      tamperOldValue,
      tamperNewValue,
    };
  }

  // credential_theft — target is the root password on the target machine
  const targetCreds = credentials[targetMachine.ip] ?? [];
  const rootCred = targetCreds.find((c) => c.username === 'root');
  const rootPassword = rootCred?.password ?? 'unknown';

  return {
    type: 'credential_theft',
    description: `Discover the root password for ${targetMachine.hostname}`,
    targetMachine: targetMachine.ip,
    targetPath: '',
    targetContent: '',
    clientEmail,
    expectedProof: rootPassword,
  };
};

export const generateAttackChain = (input: AttackChainInput): AttackChainResult => {
  const {
    prng,
    machines,
    credentials,
    entryPoint,
    entryVariant,
    difficulty,
    objectiveTypeOverride,
  } = input;

  const clientEmail = generateClientEmail(prng);
  const objectiveTypes: readonly MissionObjectiveType[] = [
    'exfiltrate',
    'tamper',
    'credential_theft',
  ];

  const path = buildPath(prng, machines, entryPoint, difficulty);
  if (path.length < 2) {
    const target = path[0] ?? machines[0];
    const targetIp = target?.ip ?? entryPoint;
    const targetCreds = credentials[targetIp] ?? [];
    const rootCred = targetCreds.find((c) => c.username === 'root') ?? {
      username: 'root',
      password: 'r00tpass',
    };

    // Always consume PRNG pick to preserve sequence, then apply override
    const prngObjectiveType = prng.pick(objectiveTypes);
    const objectiveType = objectiveTypeOverride ?? prngObjectiveType;
    const objective = buildObjective(prng, objectiveType, target, credentials, clientEmail);

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
      objective,
      clientEmail,
    };
  }

  const targetMachine = path[path.length - 1] as GeneratedMachine;

  const attackChain: AttackStep[] = [];
  const credentialPlacements: CredentialPlacement[] = [];

  for (let i = 0; i < path.length - 1; i++) {
    const fromMachine = path[i] as GeneratedMachine;
    const toMachine = path[i + 1] as GeneratedMachine;
    const method = i === 0 ? entryVariantToMethod(entryVariant) : getMethodForMachine(toMachine);

    const targetMachineCreds = credentials[toMachine.ip] ?? [];
    const nonRootCreds = targetMachineCreds.filter(
      (c) => c.username !== 'root' && c.username !== 'guest',
    );
    const credential = nonRootCreds.length > 0 ? prng.pick(nonRootCreds) : targetMachineCreds[0];

    if (!credential) continue;

    const placement = prng.pick(placementTemplates);
    const fromCreds = credentials[fromMachine.ip] ?? [];
    const localUsers = fromCreds.filter((c) => c.username !== 'root' && c.username !== 'guest');
    const localUser = localUsers.length > 0 ? prng.pick(localUsers).username : 'admin';

    // ~30% chance to wrap credential in a binary file
    const isBinary = prng.next() < 0.3;

    const hint = isBinary
      ? prng
          .pick(binaryHintTemplates)
          .replace('{{machine}}', fromMachine.hostname)
          .replace('{{path}}', prng.pick(binaryCredentialPaths[fromMachine.role]))
      : placement.hint
          .replace('{{machine}}', fromMachine.hostname)
          .replace('{{localUser}}', localUser);

    attackChain.push({
      fromMachine: i === 0 ? 'entry' : fromMachine.ip,
      toMachine: toMachine.ip,
      method,
      credential,
      hint,
    });

    const filePath = isBinary
      ? prng.pick(binaryCredentialPaths[fromMachine.role])
      : placement.path.replace('{{localUser}}', localUser);
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
      binary: isBinary || undefined,
    });
  }

  // Always consume PRNG pick to preserve sequence, then apply override
  const prngObjectiveType = prng.pick(objectiveTypes);
  const objectiveType = objectiveTypeOverride ?? prngObjectiveType;
  const objective = buildObjective(prng, objectiveType, targetMachine, credentials, clientEmail);

  return {
    attackChain,
    credentialPlacements,
    objective,
    clientEmail,
  };
};
