export {
  clientHandles,
  usernamesByRole,
  guestPasswords,
  passwords,
  wordlistPasswords,
  hostnamesByRole,
} from './machines';
export type { PortTemplate, EntryPortTemplate } from './ports';
export {
  portTemplatesByRole,
  backdoorPorts,
  forwardPublicPorts,
  snmpRwCommunities,
  entryPortTemplates,
  routerEntryPortTemplates,
} from './ports';
export type { VulnerabilityTemplate } from './vulnerabilities';
export { vulnerabilityTemplates } from './vulnerabilities';
export type { TargetFileTemplate, TamperFileTemplate, KeyPlacementTemplate } from './filesystem';
export {
  authLogTemplates,
  syslogTemplates,
  kernLogTemplates,
  mailLogTemplates,
  accessLogTemplates,
  vsftpdLogTemplates,
  mysqlLogTemplates,
  redisLogTemplates,
  configTemplatesByRole,
  noiseFiles,
  targetFileTemplatesByRole,
  tamperFileTemplatesByRole,
  keyPlacementTemplates,
  redHerringFiles,
} from './filesystem';
export { webContentTemplates, webContentTemplatesByRole } from './web';
export type { CredentialLeakTemplate } from './credentialLeakTemplates';
export { credentialLeakTemplates } from './credentialLeakTemplates';
export type { CrossMachineCredentialLeakTemplate } from './crossMachineCredentialLeakTemplates';
export { crossMachineCredentialLeakTemplates } from './crossMachineCredentialLeakTemplates';
export type { WebCredentialTemplate } from './webCredentialTemplates';
export { webCredentialTemplates } from './webCredentialTemplates';
export type { HttpEntryCredentialTemplate } from './httpEntryCredentialTemplates';
export { httpEntryCredentialTemplates } from './httpEntryCredentialTemplates';
export type { ScriptFixTemplate } from './scriptFix';
export { scriptFixTemplatesByRole } from './scriptFix';
export type { ScriptAutoTemplate } from './scriptAuto';
export { scriptAutoTemplatesByRole } from './scriptAuto';
export type { MalwareTemplate, MalwareType, MalwareLocation } from './malware';
export { malwareTemplatesByRole } from './malware';
export type { ForensicsLogType, ForensicsCallingCardTemplate } from './forensics';
export {
  forensicsLogTypes,
  forensicsCallingCardTemplates,
  forensicsNoiseIps,
  forensicsNoiseUsers,
  forensicsNoiseHttpPaths,
  forensicsNoiseCount,
} from './forensics';
