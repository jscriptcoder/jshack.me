import type { FileNode } from '../filesystem/types';
import type { NetworkConfig, RemoteMachine } from '../network/types';

export type MachineRole = 'webserver' | 'database' | 'fileserver' | 'workstation' | 'router';

export type Difficulty = 'easy' | 'medium' | 'hard';

export type AttackMethod = 'ssh' | 'ftp' | 'nc' | 'su' | 'exploit';

export type AttackStep = {
  readonly fromMachine: string;
  readonly toMachine: string;
  readonly method: AttackMethod;
  readonly credential: { readonly username: string; readonly password: string };
  readonly hint: string;
};

export type MissionObjectiveType = 'exfiltrate' | 'tamper' | 'credential_theft';

export type MissionObjective = {
  readonly type: MissionObjectiveType;
  readonly description: string;
  readonly targetMachine: string;
  readonly targetPath: string;
  readonly targetContent: string;
  readonly clientEmail: string;
  readonly expectedProof: string;
  readonly tamperOldValue?: string;
  readonly tamperNewValue?: string;
};

export type GeneratedMachine = {
  readonly ip: string;
  readonly hostname: string;
  readonly role: MachineRole;
  readonly remoteMachine: RemoteMachine;
};

export type CredentialPlacement = {
  readonly machineIp: string;
  readonly filePath: string;
  readonly fileContent: string;
  readonly username: string;
  readonly password: string;
};

export type CredentialMap = Readonly<
  Record<string, readonly { readonly username: string; readonly password: string }[]>
>;

export type EntryVariant = 'ssh' | 'ftp' | 'nc' | 'exploit';

export type MissionNetwork = {
  readonly seed: string;
  readonly difficulty: Difficulty;
  readonly entryPoint: string;
  readonly entryVariant: EntryVariant;
  readonly entryCredential?: { readonly username: string; readonly password: string };
  readonly machines: readonly GeneratedMachine[];
  readonly fileSystems: Readonly<Record<string, FileNode>>;
  readonly networkConfig: NetworkConfig;
  readonly attackChain: readonly AttackStep[];
  readonly objective: MissionObjective;
  readonly clientEmail: string;
  readonly routerPublicIp: string;
  readonly routerMachine: GeneratedMachine;
  readonly natForwarding?: NatForwarding;
};

export type NatForwarding = {
  readonly publicIp: string;
  readonly internalIp: string;
};

export type SeedOverrides = {
  readonly difficulty?: Difficulty;
  readonly entryVariant?: EntryVariant;
  readonly forwarded?: boolean;
  readonly objectiveType?: MissionObjectiveType;
};
