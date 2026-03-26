export {
  clientHandles,
  usernamesByRole,
  guestPasswords,
  passwords,
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
  logTemplates,
  configTemplatesByRole,
  noiseFiles,
  targetFileTemplatesByRole,
  tamperFileTemplatesByRole,
  keyPlacementTemplates,
  redHerringFiles,
} from './filesystem';
export { webContentTemplates, webContentTemplatesByRole } from './web';
export type { CredentialLeakTemplate, HttpEntryCredentialTemplate } from './credentials';
export { credentialLeakTemplates, httpEntryCredentialTemplates } from './credentials';
export type { ScriptFixTemplate } from './scripts';
export { scriptFixTemplatesByRole } from './scripts';
export type { ForensicsLogType, ForensicsCallingCardTemplate } from './forensics';
export {
  forensicsLogTypes,
  forensicsCallingCardTemplates,
  forensicsNoiseIps,
  forensicsNoiseUsers,
  forensicsNoiseHttpPaths,
  forensicsNoiseCount,
} from './forensics';
