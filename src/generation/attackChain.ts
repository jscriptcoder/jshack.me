import type { Prng } from './prng';
import type {
  CredentialMap,
  Difficulty,
  GeneratedMachine,
  KeyPlacement,
  MissionObjective,
  MissionObjectiveType,
  ScriptBugType,
  SubnetLayer,
} from './types';
import {
  backdoorPorts,
  clientHandles,
  forwardPublicPorts,
  keyPlacementTemplates,
  malwareTemplatesByRole,
  scriptAutoTemplatesByRole,
  scriptFixTemplatesByRole,
  targetFileTemplatesByRole,
  tamperFileTemplatesByRole,
} from './pools';
import type { MalwareLocation } from './pools';
import { binaryKeyPaths, binaryTargetPaths } from './binary';
import { encryptContent, bytesToHex } from '../utils/crypto';
import { generatePublicIp } from './ip';
import {
  generateDatabase,
  enrichForDbExfiltrate,
  enrichForDbTamper,
  enrichForDbFix,
  enrichForDbSabotage,
  type DbEnrichment,
} from './pools/database';

type BuildObjectiveInput = {
  readonly prng: Prng;
  readonly machines: readonly GeneratedMachine[];
  readonly credentials: CredentialMap;
  readonly entryPoint: string;
  readonly difficulty: Difficulty;
  readonly objectiveTypeOverride?: MissionObjectiveType;
  readonly encryptedOverride?: boolean;
  readonly layers?: readonly SubnetLayer[];
};

type BuildObjectiveResult = {
  readonly objective: MissionObjective;
  readonly clientEmail: string;
  readonly dbEnrichment?: DbEnrichment;
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

// Selects a role-appropriate script fix template and picks a bug type via PRNG.
const selectScriptFixFile = (
  prng: Prng,
  targetMachine: GeneratedMachine,
): {
  readonly targetPath: string;
  readonly targetContent: string;
  readonly bugType: ScriptBugType;
  readonly hintPath: string;
  readonly hintContent: string;
  readonly expectedChecksum: string;
} => {
  const templates = scriptFixTemplatesByRole[targetMachine.role];
  const template = prng.pick(templates);

  const bugTypes: readonly ScriptBugType[] = ['syntax', 'logic', 'corrupted'];
  const bugType = prng.pick(bugTypes);

  const targetContent = template.bugVariants[bugType];

  return {
    targetPath: template.path,
    targetContent,
    bugType,
    hintPath: template.corruptedHintPath,
    hintContent: template.corruptedHintContent,
    expectedChecksum: template.expectedChecksum,
  };
};

// Script location prefix map
const scriptLocationPrefixes: Readonly<Record<string, string>> = {
  'cron.d': '/etc/cron.d',
  'init.d': '/etc/init.d',
  'if-up.d': '/etc/network/if-up.d',
};

// Malware persistence location prefix map
const malwareLocationPrefixes: Readonly<Record<MalwareLocation, string>> = {
  'cron.d': '/etc/cron.d',
  'init.d': '/etc/init.d',
  'if-up.d': '/etc/network/if-up.d',
  'cron.daily': '/etc/cron.daily',
  'cron.hourly': '/etc/cron.hourly',
  'rc.local': '/etc',
  systemd: '/etc/systemd/system',
  manual: '/tmp',
};

// Deep paths for hard difficulty malware (manual location)
const malwareDeepPaths: readonly string[] = [
  '/var/lib/dpkg/.cache',
  '/var/tmp/.update',
  '/usr/local/share/.config',
  '/opt/.service',
  '/var/cache/apt/.tmp',
];

// Selects malware file path based on template and difficulty.
// Easy: standard location, obvious name. Medium: possibly hidden. Hard: hidden + deep path.
const selectMalwarePath = (
  prng: Prng,
  location: MalwareLocation,
  scriptName: string,
  difficulty: Difficulty,
): string => {
  const hiddenRoll = prng.next();
  const isHidden = difficulty === 'hard' || (difficulty === 'medium' && hiddenRoll < 0.5);
  const fileName = isHidden ? `.${scriptName}` : scriptName;

  if (difficulty === 'hard' && location === 'manual') {
    const deepPath = prng.pick(malwareDeepPaths);
    return `${deepPath}/${fileName}`;
  }

  // Always consume a PRNG roll for deep path to preserve sequence
  prng.next();

  const prefix = malwareLocationPrefixes[location];
  return `${prefix}/${fileName}`;
};

// Selects a role-appropriate script_auto template and builds the stub script content.
const selectScriptAutoFile = (
  prng: Prng,
  targetMachine: GeneratedMachine,
  peerMachines: readonly GeneratedMachine[],
): {
  readonly targetPath: string;
  readonly targetContent: string;
  readonly expectedChecksum: string;
  readonly flavor: 'local' | 'remote';
  readonly dataPath: string;
  readonly dataContent: string;
  readonly apiMachine?: string;
} => {
  const templates = scriptAutoTemplatesByRole[targetMachine.role];
  const template = prng.pick(templates);

  const locationPrefix = scriptLocationPrefixes[template.location]!;
  const targetPath = `${locationPrefix}/${template.scriptName}`;

  // For remote flavor, find a peer machine to host the API endpoint
  const httpCandidates = peerMachines.filter(
    (m) => m.ip !== targetMachine.ip && m.role !== 'router' && m.role !== 'switch',
  );

  // If remote but no peer available, fall back to local-style (read data locally)
  const effectiveFlavor =
    template.flavor === 'remote' && httpCandidates.length === 0 ? 'local' : template.flavor;

  if (effectiveFlavor === 'local') {
    const dataPath =
      template.flavor === 'local'
        ? template.dataFileName
        : `/var/lib/${template.dataFileName}.json`;
    const targetContent = template.instructions;

    return {
      targetPath,
      targetContent,
      expectedChecksum: template.expectedChecksum,
      flavor: 'local',
      dataPath,
      dataContent: template.dataContent,
    };
  }

  // Remote: pick API host machine
  const apiMachine = prng.pick(httpCandidates);
  const apiIp = apiMachine.ip;
  const targetContent = template.instructions.replace(/\{\{apiIp\}\}/g, apiIp);

  return {
    targetPath,
    targetContent,
    expectedChecksum: template.expectedChecksum,
    flavor: 'remote',
    dataPath: template.dataFileName,
    dataContent: template.dataContent,
    apiMachine: apiIp,
  };
};

const generateClientEmail = (prng: Prng): string => {
  const handle = prng.pick(clientHandles);
  return `${handle}@darkmail.onion`;
};

// Generates a deterministic 64-char hex key (32 bytes) from PRNG.
const generateEncryptionKey = (prng: Prng): string => {
  const bytes = new Uint8Array(Array.from({ length: 32 }, () => prng.nextInt(0, 255)));
  return bytesToHex(bytes);
};

// Builds a key placement on a machine different from the target.
const buildKeyPlacement = (
  prng: Prng,
  keyHex: string,
  keyMachine: GeneratedMachine,
  credentials: CredentialMap,
): KeyPlacement => {
  const template = prng.pick(keyPlacementTemplates);
  const machineCreds = credentials[keyMachine.ip] ?? [];
  const regularUser =
    machineCreds.find((c) => c.username !== 'root' && c.username !== 'guest')?.username ?? 'admin';

  const filePath = template.path.replace(/\{\{user\}\}/g, regularUser);
  const fileContent = template.template.replace(/\{\{key\}\}/g, keyHex);

  // ~25% chance to wrap key file in binary noise
  const isBinary = prng.next() < 0.25;
  const finalPath = isBinary ? prng.pick(binaryKeyPaths[keyMachine.role]) : filePath;

  return {
    machineIp: keyMachine.ip,
    filePath: finalPath,
    fileContent,
    binary: isBinary || undefined,
  };
};

const isDbObjective = (type: MissionObjectiveType): boolean =>
  type === 'db_exfiltrate' || type === 'db_tamper' || type === 'db_sabotage' || type === 'db_fix';

// Picks the target machine. With multi-layer subnets, the target is always in the
// deepest layer. For portforward, the target must be in layer 0 (reachable from
// the outer router). Gateway machines are never targets. Database objectives
// prefer database-role machines (port 3306 open).
const pickTarget = (
  prng: Prng,
  machines: readonly GeneratedMachine[],
  entryPoint: string,
  objectiveType: MissionObjectiveType,
  layers?: readonly SubnetLayer[],
): GeneratedMachine => {
  // With layer info: pick from the appropriate layer
  if (layers && layers.length > 1) {
    // portforward needs a layer 0 machine (reachable from outer router)
    const targetLayerIdx = objectiveType === 'portforward' ? 0 : layers.length - 1;
    const targetLayer = layers[targetLayerIdx]!;
    const layerIps = new Set(targetLayer.machines.map((m) => m.ip));
    const candidates = machines.filter(
      (m) => layerIps.has(m.ip) && m.role !== 'router' && m.role !== 'switch',
    );

    // Database objectives prefer database-role machines
    if (isDbObjective(objectiveType)) {
      const dbCandidates = candidates.filter((m) => m.role === 'database');
      if (dbCandidates.length > 0) return prng.pick(dbCandidates);
    }

    // Always consume PRNG to preserve sequence
    return candidates.length > 0 ? prng.pick(candidates) : prng.pick(machines);
  }

  // Single layer or no layer info: legacy behavior
  const nonEntry = machines.filter(
    (m) => m.ip !== entryPoint && m.role !== 'router' && m.role !== 'switch',
  );

  // Database objectives prefer database-role machines
  if (isDbObjective(objectiveType)) {
    const dbCandidates = nonEntry.filter((m) => m.role === 'database');
    if (dbCandidates.length > 0) return prng.pick(dbCandidates);
  }

  if (nonEntry.length === 0) {
    const entry = machines.find((m) => m.ip === entryPoint);
    return entry ?? machines[0]!;
  }
  return prng.pick(nonEntry);
};

// Builds the objective for a given type, target machine, and credentials.
// When encrypted is true for exfiltrate, the target content is encrypted and
// the decryption key is placed on a different machine in the attack path.
const buildObjective = (
  prng: Prng,
  objectiveType: MissionObjectiveType,
  targetMachine: GeneratedMachine,
  credentials: CredentialMap,
  clientEmail: string,
  difficulty: Difficulty,
  encryptionConfig?: {
    readonly encrypted: boolean;
    readonly machines: readonly GeneratedMachine[];
    readonly entryPoint: string;
  },
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

    // Always consume a PRNG roll for encryption chance to preserve sequence
    const encryptRoll = prng.next();
    const isEncrypted = encryptionConfig?.encrypted ?? encryptRoll < 0.25;

    if (isEncrypted && encryptionConfig) {
      const keyHex = generateEncryptionKey(prng);

      // Pick a key machine: prefer a non-target machine from the path
      const nonTarget = encryptionConfig.machines.filter((m) => m.ip !== targetMachine.ip);
      const keyMachine = nonTarget.length > 0 ? prng.pick(nonTarget) : targetMachine;
      const keyPlacement = buildKeyPlacement(prng, keyHex, keyMachine, credentials);

      // Encrypt the target content
      const encryptedContent = encryptContent(targetContent, keyHex);

      return {
        type: 'exfiltrate',
        description: `Decrypt and exfiltrate the secret data from ${targetMachine.hostname}`,
        targetMachine: targetMachine.ip,
        targetPath: `${finalPath}.enc`,
        targetContent: encryptedContent,
        clientEmail,
        expectedProof: accessKey,
        binary: isBinary || undefined,
        encrypted: true,
        encryptionKey: keyHex,
        keyPlacement,
      };
    }

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

  if (objectiveType === 'script_fix') {
    const { targetPath, targetContent, bugType, hintPath, hintContent, expectedChecksum } =
      selectScriptFixFile(prng, targetMachine);

    // Get root password for briefing (player is an authorized contractor)
    const targetCreds = credentials[targetMachine.ip] ?? [];
    const rootCred = targetCreds.find((c) => c.username === 'root');
    const rootPassword = rootCred?.password ?? 'unknown';

    return {
      type: 'script_fix',
      description: `Fix the broken script on ${targetMachine.hostname}. Root password: ${rootPassword}`,
      targetMachine: targetMachine.ip,
      targetPath,
      targetContent,
      clientEmail,
      expectedProof: '',
      scriptBugType: bugType,
      scriptHintPath: bugType === 'corrupted' ? hintPath : undefined,
      scriptHintContent: bugType === 'corrupted' ? hintContent : undefined,
      expectedChecksum,
    };
  }

  if (objectiveType === 'script_auto') {
    const peerMachines = encryptionConfig?.machines ?? [];
    const {
      targetPath,
      targetContent,
      expectedChecksum,
      flavor,
      dataPath,
      dataContent,
      apiMachine,
    } = selectScriptAutoFile(prng, targetMachine, peerMachines);

    // Get root password for briefing (player is an authorized contractor)
    const targetCreds = credentials[targetMachine.ip] ?? [];
    const rootCred = targetCreds.find((c) => c.username === 'root');
    const rootPassword = rootCred?.password ?? 'unknown';

    return {
      type: 'script_auto',
      description: `Write and deploy the automated script on ${targetMachine.hostname}. Root password: ${rootPassword}`,
      targetMachine: targetMachine.ip,
      targetPath,
      targetContent,
      clientEmail,
      expectedProof: '',
      expectedChecksum,
      scriptAutoFlavor: flavor,
      scriptAutoDataPath: dataPath,
      scriptAutoDataContent: dataContent,
      scriptAutoApiMachine: apiMachine,
    };
  }

  if (objectiveType === 'sabotage') {
    // Consume dummy PRNG rolls for binary + encrypt to preserve sequence alignment
    prng.next();
    prng.next();

    return {
      type: 'sabotage',
      description: `Destroy the target machine — ${targetMachine.hostname}`,
      targetMachine: targetMachine.ip,
      targetPath: '',
      targetContent: '',
      clientEmail,
      expectedProof: '',
    };
  }

  if (objectiveType === 'backdoor') {
    const port = prng.pick(backdoorPorts);
    // Easy: guest (60%) or user (40%). Medium/Hard: always root.
    const userRoll = prng.next();
    const backdoorUser: 'root' | 'user' | 'guest' =
      difficulty === 'easy' ? (userRoll < 0.6 ? 'guest' : 'user') : 'root';

    // Consume dummy PRNG rolls for binary + encrypt to preserve sequence alignment
    prng.next();
    prng.next();

    return {
      type: 'backdoor',
      description: `Open a backdoor on port ${port} on ${targetMachine.hostname}`,
      targetMachine: targetMachine.ip,
      targetPath: '',
      targetContent: '',
      clientEmail,
      expectedProof: '',
      backdoorPort: port,
      backdoorUser,
    };
  }

  if (objectiveType === 'portforward') {
    // Pick an internal machine (non-router) to expose via port forwarding.
    // The targetMachine from buildPath is the machine to expose.
    // Find a service port on it to forward.
    const openPorts = targetMachine.remoteMachine.ports.filter(
      (p) => p.open && p.service !== 'elite',
    );
    const servicePort = openPorts.length > 0 ? prng.pick(openPorts) : { port: 22, service: 'ssh' };
    const publicPort = prng.pick(forwardPublicPorts);

    // Consume dummy PRNG rolls for binary + encrypt to preserve sequence alignment
    prng.next();
    prng.next();

    return {
      type: 'portforward',
      description: `Set up NAT forwarding: expose ${targetMachine.hostname} port ${servicePort.port} on public port ${publicPort}`,
      targetMachine: targetMachine.ip,
      targetPath: '',
      targetContent: '',
      clientEmail,
      expectedProof: '',
      forwardPublicPort: publicPort,
      forwardInternalIp: targetMachine.ip,
      forwardInternalPort: servicePort.port,
    };
  }

  if (objectiveType === 'forensics') {
    // Pick attacker handle — must differ from mission client
    const clientHandle = clientEmail.split('@')[0];
    const availableHandles = clientHandles.filter((h) => h !== clientHandle);
    const attackerHandle = prng.pick(availableHandles);
    const attackerIp = generatePublicIp(prng);

    // Get root password for briefing (player is an authorized investigator)
    const targetCreds = credentials[targetMachine.ip] ?? [];
    const rootCred = targetCreds.find((c) => c.username === 'root');
    const rootPassword = rootCred?.password ?? 'unknown';

    // Consume dummy PRNG rolls to preserve sequence alignment
    prng.next();
    prng.next();

    return {
      type: 'forensics',
      description: `Investigate the breach on ${targetMachine.hostname}. Send us the attacker's alias and their origin IP. Root password: ${rootPassword}`,
      targetMachine: targetMachine.ip,
      targetPath: '',
      targetContent: '',
      clientEmail,
      expectedProof: `${attackerHandle}:${attackerIp}`,
      attackerHandle,
      attackerIp,
    };
  }

  if (objectiveType === 'malware') {
    const templates = malwareTemplatesByRole[targetMachine.role];
    const template = prng.pick(templates);
    const targetPath = selectMalwarePath(prng, template.location, template.scriptName, difficulty);
    const pidName = `${template.pidName}.pid`;
    const malwarePidPath = `/var/run/${pidName}`;

    // Get root password for briefing (player is an authorized contractor)
    const malwareCreds = credentials[targetMachine.ip] ?? [];
    const malwareRootCred = malwareCreds.find((c) => c.username === 'root');
    const malwareRootPassword = malwareRootCred?.password ?? 'unknown';

    // Consume dummy PRNG rolls for binary + encrypt to preserve sequence alignment
    prng.next();
    prng.next();

    return {
      type: 'malware',
      description: `Identify and neutralize the malware on ${targetMachine.hostname}. Root password: ${malwareRootPassword}`,
      targetMachine: targetMachine.ip,
      targetPath,
      targetContent: template.content,
      clientEmail,
      expectedProof: '',
      binary: template.binary || undefined,
      malwarePidPath,
      malwarePidName: pidName,
    };
  }

  if (objectiveType === 'db_exfiltrate') {
    // Consume dummy PRNG rolls for binary + encrypt to preserve sequence alignment
    prng.next();
    prng.next();

    return {
      type: 'db_exfiltrate',
      description: `Exfiltrate the secret access key from the database on ${targetMachine.hostname}`,
      targetMachine: targetMachine.ip,
      targetPath: '',
      targetContent: '',
      clientEmail,
      expectedProof: '', // Filled after enrichment
    };
  }

  if (objectiveType === 'db_tamper') {
    // Consume dummy PRNG rolls for binary + encrypt to preserve sequence alignment
    prng.next();
    prng.next();

    return {
      type: 'db_tamper',
      description: `Tamper with the database records on ${targetMachine.hostname}`,
      targetMachine: targetMachine.ip,
      targetPath: '',
      targetContent: '',
      clientEmail,
      expectedProof: '',
    };
  }

  if (objectiveType === 'db_sabotage') {
    // Consume dummy PRNG rolls for binary + encrypt to preserve sequence alignment
    prng.next();
    prng.next();

    return {
      type: 'db_sabotage',
      description: `Destroy the database on ${targetMachine.hostname}`,
      targetMachine: targetMachine.ip,
      targetPath: '',
      targetContent: '',
      clientEmail,
      expectedProof: '',
    };
  }

  if (objectiveType === 'db_fix') {
    // Get root password for briefing (player is an authorized contractor)
    const dbFixCreds = credentials[targetMachine.ip] ?? [];
    const dbFixRootCred = dbFixCreds.find((c) => c.username === 'root');
    const dbFixRootPassword = dbFixRootCred?.password ?? 'unknown';

    // Consume dummy PRNG rolls for binary + encrypt to preserve sequence alignment
    prng.next();
    prng.next();

    return {
      type: 'db_fix',
      description: `Fix the corrupted database records on ${targetMachine.hostname}. Root password: ${dbFixRootPassword}`,
      targetMachine: targetMachine.ip,
      targetPath: '',
      targetContent: '',
      clientEmail,
      expectedProof: '',
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

export const buildMissionObjective = (input: BuildObjectiveInput): BuildObjectiveResult => {
  const {
    prng,
    machines,
    credentials,
    entryPoint,
    difficulty,
    objectiveTypeOverride,
    encryptedOverride,
    layers,
  } = input;

  const clientEmail = generateClientEmail(prng);
  const objectiveTypes: readonly MissionObjectiveType[] = [
    'exfiltrate',
    'tamper',
    'credential_theft',
    'script_fix',
    'script_auto',
    'sabotage',
    'backdoor',
    'malware',
  ];

  // Always consume PRNG pick to preserve sequence, then apply override
  const prngObjectiveType = prng.pick(objectiveTypes);
  const objectiveType = objectiveTypeOverride ?? prngObjectiveType;

  // Pick target from the appropriate layer (deepest for most objectives)
  const nonGatewayMachines = machines.filter((m) => m.role !== 'router' && m.role !== 'switch');
  const targetMachine = pickTarget(prng, nonGatewayMachines, entryPoint, objectiveType, layers);

  const objective = buildObjective(
    prng,
    objectiveType,
    targetMachine,
    credentials,
    clientEmail,
    difficulty,
    {
      encrypted: encryptedOverride ?? false,
      machines: nonGatewayMachines,
      entryPoint,
    },
  );

  // Database objectives: generate a base database, enrich it with mission content,
  // and patch the objective with enrichment details (expectedProof, tamper values).
  if (isDbObjective(objectiveType)) {
    const targetCreds = credentials[targetMachine.ip] ?? [];
    const usernames = targetCreds.map((c) => c.username);
    const baseDb = generateDatabase(prng, usernames);

    const enrichFn =
      objectiveType === 'db_exfiltrate'
        ? enrichForDbExfiltrate
        : objectiveType === 'db_tamper'
          ? enrichForDbTamper
          : objectiveType === 'db_sabotage'
            ? enrichForDbSabotage
            : enrichForDbFix;
    const enrichment = enrichFn(prng, baseDb);

    const enrichedObjective: MissionObjective = {
      ...objective,
      expectedProof: enrichment.expectedProof ?? objective.expectedProof,
      dbTargetTable: enrichment.targetTable,
      dbTamperColumn: enrichment.tamperColumn,
      dbTamperOldValue: enrichment.tamperOldValue,
      dbTamperNewValue: enrichment.tamperNewValue,
    };

    return { objective: enrichedObjective, clientEmail, dbEnrichment: enrichment };
  }

  return { objective, clientEmail };
};
