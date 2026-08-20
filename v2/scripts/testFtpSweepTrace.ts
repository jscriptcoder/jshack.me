// Wire-payload smoke for the SERVICE-ROUTED sweep trace — `hydraCrack` against ftp.
// Drives the REAL /api/sessions endpoint against a running `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - `hydra <host> ftp` writes its trace to the target's `/var/log/vsftpd.log`, in
//     vsftpd's own line shape, and writes NOTHING to `auth.log`.
//   - `hydra <host> ssh` still writes `auth.log` and nothing to `vsftpd.log`.
//
// Unit tests inject a fake `upsertPatch`, so which PATH a row lands at is asserted
// against a spy rather than against the table. The routing is one field read off a
// catalog row; a handler that wrote both rows to the same path — or that never wrote
// the second one at all because the upsert conflict target collides — passes every
// unit test in the suite. Only a real round-trip can tell the two files apart.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testFtpSweepTrace.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env / no usable host.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { generateHomeLan, type LanHost } from '../src/core/generation/generateHomeLan';
import { hostServices } from '../src/core/generation/remoteHostFs';
import { machineIdForLanHost } from '../src/core/generation/lanHostIdentity';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog';
import {
  DEFAULT_WORDLIST,
  WORDLIST_PATH,
  WORDLIST_PERMISSIONS,
  formatWordlist,
} from '../src/core/wordlist/defaultWordlist';
import { AUTH_LOG_PATH } from '../src/core/logging/authLog';
import { VSFTPD_LOG_OWNER, VSFTPD_LOG_PATH } from '../src/core/logging/vsftpdLog';

const SESSIONS = process.env.SESSIONS_ENDPOINT ?? 'http://localhost:3100/api/sessions';
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const sr = createClient(url, serviceKey, { auth: { persistSession: false } });

const results: { readonly pass: boolean }[] = [];
const check = (name: string, pass: boolean, detail: string) => {
  results.push({ pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
};

const post = async (envelope: unknown): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(SESSIONS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
};

// Chosen because it generates a host running BOTH doors — the ssh control and the
// ftp claim have to land on the same box, or "ftp wrote elsewhere" could just mean
// "a different machine". Only some ESSIDs produce one; the guard below says so.
const ESSID = 'VSFTPD-LAB-3';

const attacker = generateIdentity();
const attackerMachine = computeWorkstationId('tracelab', attacker.publicKeyHex);

const serves = (host: LanHost, spec: (typeof SERVICE_CATALOG)[keyof typeof SERVICE_CATALOG]) =>
  hostServices(ESSID, host).some((service) => service.spec === spec);

const lan = generateHomeLan(ESSID);
const target = lan.hosts.find(
  (host) =>
    host.kind === 'machine' && serves(host, SERVICE_CATALOG.ftp) && serves(host, SERVICE_CATALOG.ssh),
);

if (target === undefined) {
  console.error(`ESSID ${ESSID} has no host running BOTH ftp and ssh — pick another ESSID.`);
  process.exit(2);
}

const targetMachine = machineIdForLanHost(target, ESSID);

const readLog = async (path: string): Promise<string | null> => {
  const { data } = await sr
    .from('patches')
    .select('content, owner')
    .eq('machine_id', targetMachine)
    .eq('path', path)
    .maybeSingle();
  return (data as { content: string | null } | null)?.content ?? null;
};

const clear = async () => {
  await sr.from('patches').delete().eq('machine_id', targetMachine);
  await sr.from('patches').delete().eq('machine_id', attackerMachine);
};

const seedWordlist = async () => {
  await sr.from('patches').upsert(
    {
      writer_key: attacker.publicKeyHex,
      machine_id: attackerMachine,
      path: WORDLIST_PATH,
      content: formatWordlist(DEFAULT_WORDLIST),
      owner: 'root',
      permissions: WORDLIST_PERMISSIONS,
      node_type: 'file',
      is_new: true,
    },
    { onConflict: 'writer_key,machine_id,path' },
  );
};

const sweep = (service: string) =>
  post(
    signRequest(attacker, 'hydraCrack', {
      essid: ESSID,
      target_ip: target.ip,
      service,
      caller_machine_id: attackerMachine,
      source_ip: '192.168.1.50',
    }),
  );

const main = async (): Promise<void> => {
  await clear();
  await seedWordlist();

  const ftpSweep = await sweep('ftp');
  check(
    'hydra <host> ftp is answered',
    ftpSweep.status === 200,
    `status ${ftpSweep.status} ${JSON.stringify(ftpSweep.body)}`,
  );

  const vsftpdAfterFtp = await readLog(VSFTPD_LOG_PATH);
  check(
    'the ftp sweep lands in the daemon’s OWN log',
    vsftpdAfterFtp !== null && vsftpdAfterFtp.includes('FAIL LOGIN: Client'),
    `${VSFTPD_LOG_PATH}: ${vsftpdAfterFtp === null ? 'no row' : `${vsftpdAfterFtp.split('\n').length} lines`}`,
  );
  check(
    'and it is written in vsftpd’s shape, not sshd’s',
    vsftpdAfterFtp !== null && !vsftpdAfterFtp.includes('sshd['),
    'no syslog `sshd[pid]:` tag in the ftp trace',
  );

  const authAfterFtp = await readLog(AUTH_LOG_PATH);
  check(
    'the ftp sweep writes NOTHING to auth.log',
    authAfterFtp === null,
    `auth.log: ${authAfterFtp === null ? 'no row' : 'a row exists — the routing leaked'}`,
  );

  const { data: ownerRow } = await sr
    .from('patches')
    .select('owner, permissions')
    .eq('machine_id', targetMachine)
    .eq('path', VSFTPD_LOG_PATH)
    .maybeSingle();
  const perms = (ownerRow as { permissions?: { write?: string[] } } | null)?.permissions;
  check(
    'the log is root-owned and root-write, so a visitor cannot edit the record of their visit',
    (ownerRow as { owner?: string } | null)?.owner === VSFTPD_LOG_OWNER &&
      JSON.stringify(perms?.write) === JSON.stringify(['root']),
    `owner=${(ownerRow as { owner?: string } | null)?.owner} write=${JSON.stringify(perms?.write)}`,
  );

  // The ssh control, on the SAME box: the routing has to send it somewhere else.
  const sshSweep = await sweep('ssh');
  check(
    'hydra <host> ssh is answered',
    sshSweep.status === 200,
    `status ${sshSweep.status}`,
  );

  const authAfterSsh = await readLog(AUTH_LOG_PATH);
  check(
    'the ssh sweep still lands in auth.log, byte-for-byte as before',
    authAfterSsh !== null && authAfterSsh.includes('sshd['),
    `auth.log: ${authAfterSsh === null ? 'no row' : `${authAfterSsh.split('\n').length} lines`}`,
  );

  const vsftpdAfterSsh = await readLog(VSFTPD_LOG_PATH);
  check(
    'the ssh sweep did not append to vsftpd.log',
    vsftpdAfterSsh === vsftpdAfterFtp,
    'the ftp log is unchanged by an ssh sweep',
  );

  await clear();

  const failed = results.filter((result) => !result.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
