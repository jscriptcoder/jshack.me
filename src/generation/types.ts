import type { FileNode } from '../filesystem/types';
import type { NetworkConfig, RemoteMachine } from '../network/types';

export type MachineRole =
  | 'webserver'
  | 'database'
  | 'fileserver'
  | 'workstation'
  | 'mailserver'
  | 'iot'
  | 'router';

export type Difficulty = 'easy' | 'medium' | 'hard';

export type MissionObjectiveType =
  | 'exfiltrate'
  | 'tamper'
  | 'credential_theft'
  | 'script_fix'
  | 'sabotage'
  | 'backdoor'
  | 'portforward'
  | 'forensics';

export type ScriptBugType = 'syntax' | 'logic' | 'corrupted';

export type KeyPlacement = {
  readonly machineIp: string;
  readonly filePath: string;
  readonly fileContent: string;
  readonly binary?: boolean;
};

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
  readonly binary?: boolean;
  readonly encrypted?: boolean;
  readonly encryptionKey?: string;
  readonly keyPlacement?: KeyPlacement;
  readonly scriptBugType?: ScriptBugType;
  readonly scriptHintPath?: string;
  readonly scriptHintContent?: string;
  readonly scriptOwner?: 'root' | 'user';
  readonly expectedChecksum?: string;
  readonly backdoorPort?: number;
  readonly backdoorUser?: 'root' | 'user' | 'guest';
  readonly forwardPublicPort?: number;
  readonly forwardInternalIp?: string;
  readonly forwardInternalPort?: number;
  readonly attackerHandle?: string;
  readonly attackerIp?: string;
};

export type GeneratedMachine = {
  readonly ip: string;
  readonly hostname: string;
  readonly role: MachineRole;
  readonly accessVariant: EntryVariant;
  readonly remoteMachine: RemoteMachine;
};

export type CredentialMap = Readonly<
  Record<string, readonly { readonly username: string; readonly password: string }[]>
>;

export type EntryVariant = 'ssh' | 'ftp' | 'nc' | 'exploit' | 'http' | 'snmp';

export type SubnetLayer = {
  readonly subnet: string;
  readonly gateway: GeneratedMachine;
  readonly entryVariant: EntryVariant;
  readonly machines: readonly GeneratedMachine[];
  readonly isForwarded: boolean;
  readonly natForwarding?: NatForwarding;
};

export type MissionNetwork = {
  readonly seed: string;
  readonly difficulty: Difficulty;
  readonly entryPoint: string;
  readonly entryVariant: EntryVariant;
  readonly machines: readonly GeneratedMachine[];
  readonly fileSystems: Readonly<Record<string, FileNode>>;
  readonly networkConfig: NetworkConfig;
  readonly objective: MissionObjective;
  readonly clientEmail: string;
  readonly routerPublicIp: string;
  readonly routerMachine: GeneratedMachine;
  readonly natForwarding?: NatForwarding;
  readonly routerDomain: string;
  readonly domainEntry: boolean;
  readonly layers: readonly SubnetLayer[];
};

export type NatForwardingRule = {
  readonly publicPort: number;
  readonly internalIp: string;
  readonly internalPort: number;
};

export type NatForwarding = {
  readonly publicIp: string;
  readonly rules: readonly NatForwardingRule[];
};

export type SeedOverrides = {
  readonly difficulty?: Difficulty;
  readonly entryVariant?: EntryVariant;
  readonly forwarded?: boolean;
  readonly objectiveType?: MissionObjectiveType;
  readonly domainEntry?: boolean;
  readonly encrypted?: boolean;
};
