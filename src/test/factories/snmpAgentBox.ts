/**
 * A player's own workstation after `apt install snmp`, with the agent running — for the
 * two SNMP commands that answer their own box without the server.
 *
 * Every file comes from the production code that writes it, so a change to any format
 * arrives here.
 */

import { applyPatches } from '../../core/filesystem/applyPatches.js';
import { buildWorkstationBaseFs } from '../../core/generation/workstationFs.js';
import { md5 } from '../../core/generation/md5.js';
import {
  LOCAL_FILTER_SEED,
  RULES_V4_PATH,
  RULES_V4_PERMISSIONS,
} from '../../core/network/iptablesRules.js';
import { SNMPD_CONF_PATH, SNMPD_CONF_PERMISSIONS, SNMPD_CONF_SEED } from '../../core/snmp/conf.js';
import {
  formatSnmpdState,
  SNMPD_STATE_PATH,
  SNMPD_STATE_PERMISSIONS,
} from '../../core/snmp/rwCommunity.js';
import { ownAgentCommunity } from '../../core/snmp/ownAgent.js';
import { SERVICE_CATALOG, type ServiceSpec } from '../../core/services/serviceCatalog.js';
import {
  formatPidfileContent,
  pidfilePath,
  PIDFILE_PERMISSIONS,
} from '../../core/services/pidfile.js';
import type { Directory } from '../../core/filesystem/types.js';

export const AGENT_BOX_HOSTNAME = 'workstation';

/** The read-write community the install printed for the owner of `pubkey`. */
export const agentBoxCommunity = (pubkey: string): string => ownAgentCommunity(pubkey);

/** Their box with the agent running, its filter holding `rules`. */
export const agentBoxTree = (pubkey: string, rules: string = LOCAL_FILTER_SEED): Directory =>
  applyPatches(
    buildWorkstationBaseFs(pubkey, {
      machineName: AGENT_BOX_HOSTNAME,
      username: 'alice',
      rootPassword: 'hunter2',
    }),
    [
      {
        path: SNMPD_CONF_PATH,
        content: SNMPD_CONF_SEED,
        owner: 'root',
        permissions: SNMPD_CONF_PERMISSIONS,
      },
      {
        path: SNMPD_STATE_PATH,
        content: formatSnmpdState(md5(agentBoxCommunity(pubkey))),
        owner: 'root',
        permissions: SNMPD_STATE_PERMISSIONS,
      },
      { path: RULES_V4_PATH, content: rules, owner: 'root', permissions: RULES_V4_PERMISSIONS },
      {
        path: pidfilePath(SERVICE_CATALOG.snmp),
        content: formatPidfileContent(SERVICE_CATALOG.snmp, SERVICE_CATALOG.snmp.defaultPort),
        owner: 'root',
        permissions: PIDFILE_PERMISSIONS,
      },
    ],
  );

/** The same box with the agent stopped — the pidfile gone, which is the whole of what
 *  `systemctl stop` leaves behind. */
export const withAgentStopped = (tree: Directory): Directory =>
  applyPatches(tree, [
    {
      path: pidfilePath(SERVICE_CATALOG.snmp),
      content: null,
      owner: 'root',
      permissions: PIDFILE_PERMISSIONS,
    },
  ]);

/** A daemon other than the agent holding a port, as its own pidfile says. */
export const withDaemonOn = (tree: Directory, spec: ServiceSpec, port: number): Directory =>
  applyPatches(tree, [
    {
      path: pidfilePath(spec),
      content: formatPidfileContent(spec, port),
      owner: 'root',
      permissions: PIDFILE_PERMISSIONS,
    },
  ]);
