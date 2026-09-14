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
const USAGE_READ = 'usage: msfconsole <host> <port> <path>';

/** Why the granted tier could not have the file a read effect aimed at, said in the
 *  tool's voice rather than the filesystem's raw code. */
const READ_DENY: Readonly<Record<'not_found' | 'permission_denied' | 'is_directory', string>> = {
  not_found: 'No such file',
  permission_denied: 'Permission denied',
  is_directory: 'That is a directory, not a file',
};

/** The list side's mirror of READ_DENY. A directory names a different miss than a file —
 *  there is no `is_directory` failure for a listing, and a `not_found` reads as a missing
 *  directory rather than a missing file. */
const LIST_DENY: Readonly<Record<'not_found' | 'permission_denied' | 'not_a_directory', string>> = {
  not_found: 'No such directory',
  permission_denied: 'Permission denied',
  not_a_directory: 'That is a file, not a directory',
};

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
  /** The path the player named for a read effect, or undefined — forwarded blind,
   *  since the client cannot know the effect the fire will roll. */
  readonly arg: string | undefined;
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
    arg: attempt.arg,
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

  // A read effect hands back a file or a directory rather than a shell. Firing with no
  // path is not a mistake — the scan never says which effect a CVE carries, so the bare
  // fire is how the player learns it reads, and it names the hole and asks for a target.
  // The two shapes ask for the same third argument but describe different holes, so a
  // player who fired blind is told which kind they hit.
  if ('effect' in result) {
    if ('needsArg' in result) {
      yield errorLine(
        result.effect === 'file_read'
          ? `[-] this exploit reads a file — name one: ${USAGE_READ}`
          : `[-] this exploit lists a directory — name one: ${USAGE_READ}`,
      );
      return 1;
    }
    yield text('[+] Exploit successful!');
    if (result.effect === 'file_read') {
      if (!result.read.ok) {
        yield errorLine(`[-] ${READ_DENY[result.read.error]} (as ${result.tier}): ${attempt.arg}`);
        return 1;
      }
      yield text(`[+] Reading ${attempt.arg} (as ${result.tier}):`);
      yield text('');
      for (const line of result.read.content.split('\n')) yield text(line);
      return 0;
    }
    // The plaintext verbatim and on its own line: it is the whole prize, and a player who
    // cannot read the exact string back has been handed nothing. Nothing is pushed —
    // the lock changed, nobody walked in.
    if (result.effect === 'password_reset') {
      yield text(`[+] Password reset for '${result.username}' — new password: ${result.password}`);
      return 0;
    }
    if (!result.list.ok) {
      yield errorLine(`[-] ${LIST_DENY[result.list.error]} (as ${result.tier}): ${attempt.arg}`);
      return 1;
    }
    yield text(`[+] Listing ${attempt.arg} (as ${result.tier}):`);
    yield text('');
    for (const entry of result.list.entries) yield text(entry);
    return 0;
  }

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
  const [rawTarget, rawPort, rawArg] = args;
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
    fire(env, { targetIp, port, essid, machineId, sourceIp: wlan0.ipv4, arg: rawArg }),
  );
};

export const msfconsole: Command = {
  name: 'msfconsole',
  description: 'Exploit a known vulnerability on a network service',
  category: 'network',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  // A shell effect pushes a session the calling script cannot enter, and the grammar
  // that would let a scripted fire report the door instead of standing nobody in it
  // lands with the last of these effects. Until then msfconsole stays script-gated,
  // even though some effects now read rather than land a shell.
  withoutScript: 'msfconsole: cannot be run from a script',
  manual: {
    synopsis: 'msfconsole <host> <port> [path]',
    description:
      'Attempt to exploit the service listening on a port of a host on your network. ' +
      'No password is asked for and none is needed: if the version running there has a ' +
      'published vulnerability, the service gives itself up by itself. Most holes hand ' +
      'over a shell — how much it can do follows the severity, a critical hole landing ' +
      'you as root and a lesser one as an ordinary user or a guest, and some give only a ' +
      'bare shell with no terminal behind it. Others do not open a shell at all: a read ' +
      'hole hands back the file — or the entries of the directory — you name as a third ' +
      'argument, at the tier the severity granted. A reset hole takes no argument at all: ' +
      'it changes the password of the account that tier names and tells you the new one, ' +
      'which is then yours to use wherever that account is taken. Find a candidate with "nmap -sV", ' +
      'which reports the version and names ' +
      'the vulnerability when one has been published, but never what it does — firing is ' +
      'what reveals that. A service that is up to date refuses, and the target writes ' +
      'down that you tried.',
    arguments: [
      { name: 'host', description: 'Target host IP or name on your network', required: true },
      { name: 'port', description: 'The port the vulnerable service listens on', required: true },
      {
        name: 'path',
        description:
          'For a read hole, the file or directory to read — the exploit asks for one if omitted',
        required: false,
      },
    ],
    examples: [
      { command: 'msfconsole 192.168.1.5 22', description: 'Exploit the ssh service on a host' },
      { command: 'msfconsole web-04 80', description: 'Exploit a web server by its name' },
    ],
  },
  execute,
};
