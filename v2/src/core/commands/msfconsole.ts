/**
 * msfconsole — fire the CVE a version scan already named, and walk in.
 *
 * The player-facing half of the exploit layer. It decides NOTHING: the server
 * recomputes the game day from its own clock, regenerates the target, reads that
 * box's own package manifest, and answers what is published there and what it
 * grants. This command resolves the target, streams the attempt, and stands the
 * player wherever the answer put them — so `nmap -sV` and `msfconsole` can never
 * disagree about whether a hole exists.
 *
 * It runs wherever the player stands, like `hydra`: a rooted box with metasploit
 * installed is a place to attack FROM.
 *
 * The one message that matters is the refusal. A patched daemon, a filtered port
 * and a planted `nc` listener all bounce with the SAME sentence, because a bounce
 * that said which of those it was would turn a failed exploit into a free scan.
 * The difference lives in the defender's log, which is where it is worth having.
 *
 * Pacing follows `hydra`'s: the phases are announced through the abort-aware
 * `env.sleep`, so Ctrl-C stops a run. Every sleep happens BEFORE the round trip
 * on purpose — an abort after the server has minted the row would leave a session
 * standing on a box the player was never put on.
 */

import { asMachineId } from '../types';
import { connectedWlan0 } from '../network/interfaces';
import { generateHomeLan } from '../generation/generateHomeLan';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { addressForTarget } from '../network/resolveName';
import { homeDirectory } from '../sessions/homeDirectory';
import { errorLine, streamedResult, text } from './streaming';
import type { Command, CommandEnv, CommandResult, TerminalLine } from './types';

const PHASE_DELAY_MS = 260;
const MAX_PORT = 65535;
const USAGE = 'usage: msfconsole <host> <port>';

const errorResult = (content: string): CommandResult => ({
  kind: 'sync',
  lines: [errorLine(content)],
  exitCode: 1,
});

/** Worded as `ssh`'s connect failures are, because it is the same fact about the
 *  same network and a second phrasing for it would read as a second cause. */
const connectFailure = (host: string, port: number, reason: string): string =>
  `msfconsole: connect to host ${host} port ${port}: ${reason}`;

type Attempt = {
  readonly targetIp: string;
  readonly port: number;
  readonly essid: string;
  readonly machineId: string;
  readonly sourceIp: string | null;
};

async function* fire(env: CommandEnv, attempt: Attempt): AsyncGenerator<TerminalLine, number> {
  yield text(`[*] Targeting ${attempt.targetIp}:${attempt.port}`);
  await env.sleep(PHASE_DELAY_MS);
  yield text('[*] Sending exploit payload...');
  await env.sleep(PHASE_DELAY_MS);
  yield text('[*] Payload delivered, waiting for callback...');

  const sessionId = `exploit-${attempt.port}-${env.now()}`;
  const result = await env.exploit.run({
    sessionId,
    essid: attempt.essid,
    targetIp: attempt.targetIp,
    port: attempt.port,
    parentSessionId: env.session.id,
    sourceIp: attempt.sourceIp,
  });

  if (!result.ok) {
    yield errorLine(
      result.error === 'not_vulnerable'
        ? `[-] Exploit failed — no known vulnerability on ${attempt.targetIp}:${attempt.port}`
        : connectFailure(
            attempt.targetIp,
            attempt.port,
            result.error === 'host_unreachable' ? 'No route to host' : 'Network error',
          ),
    );
    return 1;
  }

  // The CVE is named on the way IN rather than up front: the client never worked
  // out which hole this was, and printing it before the callback would be the tool
  // claiming knowledge only the target could have given it.
  yield text(`[*] Vulnerability: ${result.cve} (${result.severity})`);
  yield text('[+] Exploit successful!');
  // Two sentences for two doors. A full shell is an `ssh` hop in everything but how
  // it was reached; a limited one is the backdoor it resembles, and a player told
  // "Full shell" who then cannot pivot onward has been lied to by their own tool.
  yield text(
    result.kind === 'exploit'
      ? `[+] Full shell as ${result.username}@${attempt.targetIp}`
      : `[+] Got shell as ${result.username}@${attempt.targetIp}`,
  );
  yield text('');

  env.pushSession({
    id: sessionId,
    playerKey: env.session.playerKey,
    machineId: asMachineId(attempt.machineId),
    username: result.username,
    userType: result.userType,
    kind: result.kind,
    createdAt: env.now(),
  });
  env.setCwd(homeDirectory({ username: result.username, userType: result.userType }));
  return 0;
}

const execute: Command['execute'] = async (env, args) => {
  const [rawTarget, rawPort] = args;
  if (rawTarget === undefined || rawPort === undefined) return errorResult(USAGE);
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) return errorResult(USAGE);

  const wlan0 = connectedWlan0(env.network);
  if (wlan0 === null) {
    return errorResult(connectFailure(rawTarget, port, 'Network is unreachable'));
  }
  const essid = wlan0.association.essid;

  // A name becomes an address before anything routes on it, exactly as it does for
  // `ssh` — a scan prints `web-04` and that is what a player types next.
  const targetIp = await addressForTarget({
    essid,
    target: rawTarget,
    resolveOccupants: env.scan.resolveOccupants,
  });

  // The LAN is a function of the ESSID, so an address nothing answers to is
  // answerable here: firing anyway would spend a round trip to be told what the
  // client already knew. It also yields the machine id the session lands on — the
  // same one the server derives from the same ip, so they never disagree about
  // which box the player is standing on.
  const host = generateHomeLan(essid).hosts.find((candidate) => candidate.ip === targetIp);
  if (host === undefined) {
    return errorResult(connectFailure(targetIp, port, 'No route to host'));
  }
  const { machineId } = resolveLanHostIdentity(host, essid);

  return streamedResult(
    fire(env, { targetIp, port, essid, machineId, sourceIp: wlan0.ipv4 }),
  );
};

export const msfconsole: Command = {
  name: 'msfconsole',
  description: 'Exploit a known vulnerability on a network service',
  category: 'network',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  // It pushes a session the calling script cannot see, and every effect this slice
  // grants IS a shell — so a scripted run could only report a door it then made the
  // player open again by hand. The grammar arrives with the effects that change
  // state without opening one.
  withoutScript: 'msfconsole: cannot be run from a script',
  manual: {
    synopsis: 'msfconsole <host> <port>',
    description:
      'Attempt to exploit the service listening on a port of a host on your network. ' +
      'No password is asked for and none is needed: if the version running there has a ' +
      'published vulnerability, the service hands over a shell by itself. How much that ' +
      'shell can do follows the severity — a critical hole lands you as root, a lesser ' +
      'one as an ordinary user or a guest — and some holes give only a bare shell with ' +
      'no terminal behind it, which cannot be used to log on somewhere else. Find a ' +
      'candidate with "nmap -sV", which reports the version and names the vulnerability ' +
      'when one has been published. A service that is up to date refuses, and the target ' +
      'writes down that you tried.',
    arguments: [
      { name: 'host', description: 'Target host IP or name on your network', required: true },
      { name: 'port', description: 'The port the vulnerable service listens on', required: true },
    ],
    examples: [
      { command: 'msfconsole 192.168.1.5 22', description: 'Exploit the ssh service on a host' },
      { command: 'msfconsole web-04 80', description: 'Exploit a web server by its name' },
    ],
  },
  execute,
};
