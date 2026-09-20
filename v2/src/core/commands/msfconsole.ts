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

import { asAbsPath, asMachineId, type UserType } from '../types';
import { connectedWlan0 } from '../network/interfaces';
import { isPublicIp } from '../generation/ip';
import { dir } from '../generation/baseFs';
import { defaultDirectoryPermissions, defaultFilePermissions } from '../filesystem/defaultPermissions';
import { createFsView } from '../filesystem/fsView';
import { resolveWriteTarget } from '../filesystem/writeTarget';
import { describeScriptError, runScript } from '../scripting/runScript';
import { formatScriptValue } from '../scripting/format';
import type { ScriptFs } from '../scripting/fsApi';
import type { Directory } from '../filesystem/types';
import { generateHomeLan } from '../generation/generateHomeLan';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { addressForTarget } from '../network/resolveName';
import { isCrossPlayerWorkstation } from '../network/crossPlayerHop';
import { homeDirectory } from '../sessions/homeDirectory';
import { resolveAbsPath } from '../filesystem/path';
import { gameDayAt } from '../cve/worldClock';
import { parseDpkgVersions, readDpkgStatus } from '../packages/dpkgStatus';
import { localExploitOutcome, type LocalExploitOutcome } from '../cve/localExploit';
import { backdoorPortFor } from '../cve/exploitEffect';
import {
  formatListenerContent,
  listenerPidfilePath,
  PIDFILE_PERMISSIONS,
} from '../services/pidfile';
import {
  accountsIn,
  withAccountHash,
  PASSWD_OWNER,
  PASSWD_PATH,
  type NamedPasswdAccount,
} from '../sessions/passwdAccount';
import { PASSWD_FILE } from '../generation/baseFs';
import { md5 } from '../generation/md5';
import { libraryPresent } from './libraryDeps';
import { SYSTEM_LIBRARIES } from '../generation/libraries';
import { hasTty } from '../shell/runLine';
import { errorLine, streamedResult, text } from './streaming';
import { PATCH_ERROR_REASON } from './types';
import type { Command, CommandEnv, CommandResult, SessionKind, TerminalLine } from './types';

const PHASE_DELAY_MS = 260;
const MAX_PORT = 65535;
const USAGE = 'usage: msfconsole <host> <port>';
const USAGE_LOCAL = 'usage: msfconsole --local <command>';
/** A read hole aims at a file on the box the command runs on, named as a fourth token.
 *  Distinct from the service path's `msfconsole <host> <port> <path>`, which points at a
 *  target that does not exist here — a `--local` fire has no host or port to name. */
const USAGE_LOCAL_READ = 'usage: msfconsole --local <command> <path>';
/** A write hole wants a PAIR, not a single path: the bytes come from a file on this box and
 *  land on one over there — naming only a destination would leave nothing to send. Both
 *  halves are on this box for a `--local` fire, but the grammar is the service path's. */
const USAGE_LOCAL_WRITE = 'usage: msfconsole --local <command> <local:remote>';

/** `--local` reads the box's own manifest and rolls the effect client-side, which it can
 *  only do on a box it can regenerate — its owner's own or an NPC's. Another player's
 *  workstation is server-side state this side cannot see, so `--local` bounces here the
 *  way the own-box-only wireless tools do; crossing to it is a later, server-routed path. */
const LOCAL_CROSS_PLAYER = 'msfconsole: --local not available on this machine';

/** The one line a service with no live CVE, an unmapped command, a linked library with
 *  no live hole, and no account at the granted tier all bounce with — a `--local` fire
 *  that told which of those it was would turn a failed exploit into a free scan of the
 *  box's own manifest, exactly as the service path's single refusal does. */
const localMiss = (command: string): string => `msfconsole: no known vulnerability on ${command}`;

const USAGE_READ = 'usage: msfconsole <host> <port> <path>';
/** A write takes a PAIR, not a path: the bytes come from a file on this box and land on
 *  one over there, and naming only the destination would leave nothing to send. */
const USAGE_WRITE = 'usage: msfconsole <host> <port> <local:remote>';

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

/** Why the LOCAL half of a write's `local:remote` could not be read — a failure on the
 *  box the tool is run from, which is a different thing from the two maps above and has
 *  to read like one. Those describe what the TARGET refused; this describes a file the
 *  player does not have, and collapsing them would tell somebody their own typo was the
 *  remote box holding out on them.
 *
 *  Worded as the file-reading commands word it (`cat`'s vocabulary, under this tool's own
 *  prefix) rather than as `READ_DENY` does. Five commands already map an FS failure to a
 *  line and no two agree — the differences are legacy parity, deliberately not
 *  reconciled — so this joins that family instead of inventing a sixth phrasing. */
const LOCAL_READ_DENY: Readonly<
  Record<'not_found' | 'permission_denied' | 'is_directory', string>
> = {
  not_found: 'No such file or directory',
  permission_denied: 'Permission denied',
  is_directory: 'Is a directory',
};

/** Why the granted tier could not put a file where a write aimed it — the TARGET's
 *  refusal, so it is worded as `READ_DENY` is rather than as the local map above. A
 *  `not_found` here is not a missing file but a missing place to put one: the write
 *  resolved a path whose containing directory is not there. */
const WRITE_DENY: Readonly<Record<'not_found' | 'permission_denied' | 'is_directory', string>> = {
  not_found: 'No such directory to write into',
  permission_denied: 'Permission denied',
  is_directory: 'That is a directory, not a file',
};

/** What an argument-taking hole asks for when it is fired blind. A write asks for a PAIR
 *  where the reads ask for a path, so the three cannot share one sentence — a player who
 *  fired without knowing the effect is told which kind of door they actually hit. */
const NEEDS_ARG_LINE: Readonly<
  Record<'file_read' | 'dir_list' | 'file_write' | 'script_exec', string>
> = {
  file_read: `this exploit reads a file — name one: ${USAGE_READ}`,
  dir_list: `this exploit lists a directory — name one: ${USAGE_READ}`,
  file_write: `this exploit writes a file — name a pair: ${USAGE_WRITE}`,
  // Asks for the same shape a read does, and means something else by it: this path names
  // a file on the attacker's OWN box, the one whose contents get run over there.
  script_exec: `this exploit runs a script — name one: ${USAGE_READ}`,
};

/** The LOCAL half of a `local:remote` third token, or undefined when the token is not a
 *  pair: first colon, and neither half may be empty.
 *
 *  The server splits the same token for its REMOTE half. The two halves are one grammar
 *  and have to stay one — read differently, the bytes and the destination would come from
 *  different readings of a single string the player typed once. */
const localHalfOf = (arg: string): string | undefined => {
  const colon = arg.indexOf(':');
  return colon <= 0 || colon === arg.length - 1 ? undefined : arg.slice(0, colon);
};

/** The REMOTE half of the same token — the path the bytes land at. Splits on the same first
 *  colon as `localHalfOf`, so the two halves are one reading of the one string the player
 *  typed once. */
const remoteHalfOf = (arg: string): string | undefined => {
  const colon = arg.indexOf(':');
  return colon <= 0 || colon === arg.length - 1 ? undefined : arg.slice(colon + 1);
};

/** A script's filesystem when the box it is running against is NOT this one.
 *
 *  Reads come off the target's own regenerated tree. Writes are COLLECTED rather than
 *  sent, because nothing on this side is entitled to write that box: the fire carries
 *  them, and the server re-walks every one at the tier the CVE granted before any of them
 *  lands. A client can therefore propose whatever it likes and change nothing by it.
 *
 *  The tree is the box as the world GENERATES it, without the journal replayed over it —
 *  reading that needs a session this effect never mints. So a script sees the box as it
 *  shipped rather than as it stands, which is a fidelity cost the blindness of the effect
 *  already carries elsewhere.
 *
 *  The view takes no tier, which reads as an ordinary user. Deliberately the
 *  under-permissive side of the choice rather than the over: the tier is unknown until the
 *  fire returns, a read this view refuses is simply a read the script does not get, and a
 *  write it allows still has to survive the server's own walk at the real tier. */
const targetScriptFs = (
  tree: Directory,
  collected: { path: string; content: string }[],
  userType?: UserType,
): ScriptFs => {
  const view = createFsView(tree, {
    cwd: asAbsPath('/'),
    ...(userType !== undefined ? { userType } : {}),
  });
  const resolve = (path: string) => resolveAbsPath(view.cwd(), path);
  /** What the script would see at a path: its own latest write there if it has made one,
   *  else the box's own file. Without this an append after a write would reach past the
   *  script's own work to the generated file underneath it. */
  const currentAt = (target: ReturnType<typeof resolve>): string => {
    const written = [...collected].reverse().find((write) => write.path === target);
    if (written !== undefined) return written.content;
    const onBox = view.read(target);
    return onBox.ok ? onBox.content : '';
  };
  return {
    readFile: async (path) => {
      const result = view.read(resolve(path));
      // An ordinary `Error`, and worded without a command's name in front of it. The script
      // is running on the TARGET, so a miss there is the box's answer rather than this
      // tool's — and whatever is thrown here reaches the player through
      // `describeScriptError`, which puts the error's own name at the front already.
      if (!result.ok) throw new Error(`${path}: ${LOCAL_READ_DENY[result.error]}`);
      return result.content;
    },
    writeFile: async (path, data) => {
      collected.push({ path: resolve(path), content: formatScriptValue(data) });
    },
    appendFile: async (path, data) => {
      const target = resolve(path);
      collected.push({ path: target, content: `${currentAt(target)}${formatScriptValue(data)}` });
    },
  };
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
  /** The path the player named for a read effect, or undefined — forwarded blind,
   *  since the client cannot know the effect the fire will roll. */
  readonly arg: string | undefined;
  /** The bytes of the local half, when the token was a pair and this box could read it.
   *  Carried blind for the same reason `arg` is: only the server knows whether the hole
   *  it is about to fire writes anything. */
  readonly content: string | undefined;
  /** Why a BARE third token could not be read on this box, or undefined when it read or
   *  was never a local path at all.
   *
   *  Carried rather than acted on, because at the moment of reading nothing knows which
   *  kind of token it is holding: a bare path is a file on the TARGET for the read holes
   *  and a file on THIS box for the script hole. The failure only becomes news once the
   *  server says the hole runs a script — before that it is an ordinary miss on a path
   *  that was never ours to open. */
  readonly localError: 'not_found' | 'permission_denied' | 'is_directory' | undefined;
  /** What the script did, when a bare token named one this box could read. Undefined when
   *  nothing was run at all — which is a different fact from having run and written
   *  nothing, and the server tells the two apart on exactly that distinction. */
  readonly writes: readonly { readonly path: string; readonly content: string }[] | undefined;
  /** Why the script stopped early, or undefined when it finished. Carried rather than
   *  printed, for the same reason `localError` is: a read hole aimed at a path that
   *  happens to be valid JavaScript must not report a script failure nobody asked for. */
  readonly scriptError: string | undefined;
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
    arg: attempt.arg,
    content: attempt.content,
    writes: attempt.writes,
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
      // The server knows only that it was handed nothing to run, so it asks for a script.
      // This box knows the half the server cannot see: that a path WAS named and refused
      // here. Printing the ask would tell somebody who typed one that they had typed none,
      // and send them looking at the target for a mistake on their own disk.
      if (result.effect === 'script_exec' && attempt.localError !== undefined) {
        yield errorLine(`msfconsole: ${attempt.arg}: ${LOCAL_READ_DENY[attempt.localError]}`);
        return 1;
      }
      yield errorLine(`[-] ${NEEDS_ARG_LINE[result.effect]}`);
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
    // The port on its own line for the reason the plaintext is: it is the whole prize,
    // and it is the one thing the scan that found this box never reported. Nothing is
    // pushed — the door is standing open, but nobody walked through it.
    if (result.effect === 'backdoor_port_open') {
      yield text(`[+] Backdoor planted on port ${result.port}`);
      return 0;
    }
    // A write leaves something of the player's ON the box and stands them nowhere, so
    // nothing is pushed and the cwd holds — the same shape a read ends in. The path is
    // read off the ANSWER rather than split back out of what was typed: the box resolved
    // it, so it is the only side that knows where the bytes really went.
    if (result.effect === 'file_write') {
      if (!result.write.ok) {
        yield errorLine(
          `[-] ${WRITE_DENY[result.write.error]} (as ${result.tier}): ${result.write.path}`,
        );
        return 1;
      }
      yield text(
        `[+] Wrote ${result.write.bytes} bytes to ${result.write.path} (as ${result.tier})`,
      );
      return 0;
    }
    // A script ran on the box and left nothing to read back — not its output, which was
    // never captured, and not a tally of what it managed to write, which would answer a
    // question about the target's permissions the player never got to ask. So the line
    // says the one thing there is to say, and stands them nowhere, as a write does.
    if (result.effect === 'script_exec') {
      // Said only now, once the box has confirmed this hole really does run something. The
      // break-in still stands and whatever the script wrote before it stopped has already
      // travelled with the fire — a side effect that landed cannot be unwound, and the box
      // would not unwind it either. What the player is owed is where it stopped.
      if (attempt.scriptError !== undefined) {
        yield errorLine(`[-] Script injection failed: ${attempt.scriptError}`);
        return 1;
      }
      yield text(`[+] Script injected on ${attempt.targetIp} as ${result.tier}`);
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

  // A script has nowhere to be put. `env` is a per-line snapshot, so a session pushed
  // from here would leave every line after it answering about a box the script itself
  // cannot stand on — and the player would never see the prompt that proved it. The
  // door is real and worth knowing about, so it is REPORTED and the caller is left
  // exactly where it was, which is the bargain every non-shell effect already strikes.
  if (env.scripted === true) {
    // Told apart here as they are at the prompt below, and symmetrically rather than in
    // the prompt's own two voices: a script BRANCHES on this line, and a caller matching
    // "Got shell" against "Full shell" would have to know the asymmetry to see it.
    yield text(
      result.kind === 'exploit'
        ? `[+] Full shell available on ${attempt.targetIp} as ${result.username}`
        : `[+] Limited shell available on ${attempt.targetIp} as ${result.username}`,
    );
    return 0;
  }

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
    // The SERVER's answer for which box this landed on, never a client derivation: off the
    // generated LAN there is no id to derive, and deriving one would name the seeded
    // sibling standing where a real player actually is.
    machineId: asMachineId(result.machineId),
    username: result.username,
    userType: result.userType,
    kind: result.kind,
    createdAt: env.now(),
  });
  env.setCwd(homeDirectory({ username: result.username, userType: result.userType }));
  return 0;
}

/** The recon every `--local` fire streams before it either walks in or names the hole:
 *  the phases, then the vulnerability line naming the library that fell (decision 77 —
 *  there is no port to target, so the library stands in for the service). */
async function* localPreamble(
  env: CommandEnv,
  command: string,
  outcome: LocalExploitOutcome,
): AsyncGenerator<TerminalLine, void> {
  yield text(`[*] Exploiting ${command} locally`);
  await env.sleep(PHASE_DELAY_MS);
  yield text('[*] Sending exploit payload...');
  await env.sleep(PHASE_DELAY_MS);
  yield text('[*] Payload delivered, waiting for callback...');
  yield text(`[*] Vulnerability: ${outcome.cve} (${outcome.severity}) in ${outcome.library}.so`);
}

/** A shell roll: walk the player in at the granted tier, as an account the box actually
 *  has there. */
async function* fireLocalShell(
  env: CommandEnv,
  command: string,
  outcome: LocalExploitOutcome,
  account: NamedPasswdAccount,
): AsyncGenerator<TerminalLine, number> {
  yield* localPreamble(env, command, outcome);
  yield text('[+] Exploit successful!');

  // A `shell_full` from a shell with no terminal behind it (`nc`, a limited exploit)
  // still can't open a full one: the tier rises, the door does not. Every other case
  // follows the effect. The kind decides the wording, so the two never disagree.
  const kind: SessionKind =
    outcome.effect === 'shell_full' && hasTty(env.session) ? 'exploit' : 'exploit_limited';

  // A script has nowhere to be put down: `env` is a per-line snapshot, so a session
  // pushed from here would leave every later line answering about a shell the script
  // itself never stands in. The door is real and worth reporting, so it is — and the
  // caller is left where it was, the bargain the service path strikes for the same case.
  if (env.scripted === true) {
    yield text(
      kind === 'exploit'
        ? `[+] Full shell available on ${env.hostname} as ${account.username}`
        : `[+] Limited shell available on ${env.hostname} as ${account.username}`,
    );
    return 0;
  }

  yield text(
    kind === 'exploit'
      ? `[+] Full shell as ${account.username}@${env.hostname}`
      : `[+] Got shell as ${account.username}@${env.hostname}`,
  );
  yield text('');

  env.pushSession({
    id: `exploit-local-${command}-${env.now()}`,
    playerKey: env.session.playerKey,
    machineId: env.session.machineId,
    username: account.username,
    userType: outcome.tier,
    kind,
    createdAt: env.now(),
  });
  env.setCwd(homeDirectory({ username: account.username, userType: outcome.tier }));
  return 0;
}

/** A read roll: hand back the file the player named, read off THIS box through a view at
 *  the granted tier — so a file that tier cannot have bounces exactly as it would at a
 *  shell of that tier, and the same critical/high hole that grants root is what reaches the
 *  box's own `/etc/passwd`. Nothing is pushed: a read hands back bytes, not a shell, and
 *  leaves the player where they stood, the bargain every non-shell effect strikes. */
async function* fireLocalFileRead(
  env: CommandEnv,
  command: string,
  outcome: LocalExploitOutcome,
  path: string | undefined,
): AsyncGenerator<TerminalLine, number> {
  yield* localPreamble(env, command, outcome);

  // Fired blind, with no file to read: the scan never says which effect a CVE carries, so
  // a bare fire is how the player learns this one reads. The vulnerability is already
  // revealed above; here it names the hole and asks for a target rather than claiming a
  // success it has nothing to show for.
  if (path === undefined) {
    yield errorLine(`[-] this exploit reads a file — name one: ${USAGE_LOCAL_READ}`);
    return 1;
  }

  yield text('[+] Exploit successful!');

  const view = createFsView(env.fs.root(), { userType: outcome.tier, cwd: env.fs.cwd() });
  const read = view.read(resolveAbsPath(env.fs.cwd(), path));
  if (!read.ok) {
    yield errorLine(`[-] ${READ_DENY[read.error]} (as ${outcome.tier}): ${path}`);
    return 1;
  }
  yield text(`[+] Reading ${path} (as ${outcome.tier}):`);
  yield text('');
  for (const line of read.content.split('\n')) yield text(line);
  return 0;
}

/** A list roll: hand back the entries of the directory the player named, read off THIS box
 *  through a view at the granted tier — the read roll's sibling, differing only in listing
 *  a directory where the read hands back a file. Nothing is pushed. */
async function* fireLocalDirList(
  env: CommandEnv,
  command: string,
  outcome: LocalExploitOutcome,
  path: string | undefined,
): AsyncGenerator<TerminalLine, number> {
  yield* localPreamble(env, command, outcome);

  if (path === undefined) {
    yield errorLine(`[-] this exploit lists a directory — name one: ${USAGE_LOCAL_READ}`);
    return 1;
  }

  yield text('[+] Exploit successful!');

  const view = createFsView(env.fs.root(), { userType: outcome.tier, cwd: env.fs.cwd() });
  const listed = view.list(resolveAbsPath(env.fs.cwd(), path));
  if (!listed.ok) {
    yield errorLine(`[-] ${LIST_DENY[listed.error]} (as ${outcome.tier}): ${path}`);
    return 1;
  }
  yield text(`[+] Listing ${path} (as ${outcome.tier}):`);
  yield text('');
  for (const entry of listed.entries) yield text(entry);
  return 0;
}

/** A reset roll: turn the lock on the account the tier names and hand back the new key.
 *  The plaintext is derived from the CVE the player already earned (`pwned-<cve4>-<tier>`),
 *  so the box never stores it and the client and server agree on it without either being
 *  told. Nothing is pushed: a reset changes a lock, it opens no door. */
async function* fireLocalPasswordReset(
  env: CommandEnv,
  command: string,
  outcome: LocalExploitOutcome,
  account: NamedPasswdAccount,
): AsyncGenerator<TerminalLine, number> {
  yield* localPreamble(env, command, outcome);
  yield text('[+] Exploit successful!');

  const granted = `pwned-${outcome.cve.slice(-4)}-${outcome.tier}`;
  // The passwd keeps its own terms — owner root, the passwd file's permissions — so the
  // rewrite changes one hash and re-owns nothing.
  const rewritten = withAccountHash(env.fs.root(), account.username, md5(granted));
  const result = await env.patches.write(PASSWD_PATH, rewritten, {
    owner: PASSWD_OWNER,
    permissions: PASSWD_FILE,
  });
  if (!result.ok) {
    yield errorLine(`[-] Password reset failed: ${PATCH_ERROR_REASON[result.error]}`);
    return 1;
  }

  // The plaintext verbatim and on its own line: it is the whole prize, and a player who
  // cannot read the exact string back has been handed nothing.
  yield text(`[+] Password reset for '${account.username}' — new password: ${granted}`);
  return 0;
}

/** A backdoor roll: open a door and walk away from it. The port is a function of the CVE,
 *  and the pidfile IS the open port — written in exactly the shape `nc -l` leaves, so a
 *  door a CVE opened and a door a player planted are the same file. Root owns the pidfile
 *  whoever opened the port, while its content names the account the visitor arrives as.
 *  Nothing is pushed: the door stands open, but nobody walked through it. */
async function* fireLocalBackdoor(
  env: CommandEnv,
  command: string,
  outcome: LocalExploitOutcome,
  account: NamedPasswdAccount,
): AsyncGenerator<TerminalLine, number> {
  yield* localPreamble(env, command, outcome);
  yield text('[+] Exploit successful!');

  const port = backdoorPortFor(outcome.cve);
  const result = await env.patches.write(
    listenerPidfilePath(port),
    formatListenerContent({ port, user: account.username, userType: outcome.tier }),
    { owner: 'root', permissions: PIDFILE_PERMISSIONS },
  );
  if (!result.ok) {
    yield errorLine(`[-] Backdoor failed: ${PATCH_ERROR_REASON[result.error]}`);
    return 1;
  }

  // The port on its own line: it is the whole prize, and the one thing the scan that found
  // this box never reported.
  yield text(`[+] Backdoor planted on port ${port}`);
  return 0;
}

/** A write roll: plant the bytes of the player's own file at a path on the box, at the
 *  granted tier. The token is `local:remote` (decision 23), both halves on this box for a
 *  `--local` fire: the local half is the player's file, read at their own shell tier, and
 *  the remote half is where it lands, walked at the granted tier by the same resolver the
 *  box's own shell obeys. Nothing is pushed — a write leaves something behind and stands
 *  the player nowhere. `actor` owns any file the write newly creates. */
async function* fireLocalFileWrite(
  env: CommandEnv,
  command: string,
  outcome: LocalExploitOutcome,
  pair: string | undefined,
  actor: string,
): AsyncGenerator<TerminalLine, number> {
  yield* localPreamble(env, command, outcome);

  const localPath = pair === undefined ? undefined : localHalfOf(pair);
  const remotePath = pair === undefined ? undefined : remoteHalfOf(pair);
  // Nothing to write, or nowhere to put it: the fire that REVEALS the effect rather than a
  // mistake, since a scan never says a CVE writes. Names the hole, asks for a pair, and
  // leaves nothing behind.
  if (localPath === undefined || remotePath === undefined) {
    yield errorLine(`[-] this exploit writes a file — name a pair: ${USAGE_LOCAL_WRITE}`);
    return 1;
  }

  // The local half is the player's OWN file, read at their own shell tier — a file this
  // shell cannot read is not one the exploit can send, and it is refused as their own typo
  // rather than the target holding out.
  const source = env.fs.read(resolveAbsPath(env.fs.cwd(), localPath));
  if (!source.ok) {
    yield errorLine(`msfconsole: ${localPath}: ${LOCAL_READ_DENY[source.error]}`);
    return 1;
  }

  yield text('[+] Exploit successful!');

  const view = createFsView(env.fs.root(), { userType: outcome.tier, cwd: env.fs.cwd() });
  const destination = resolveWriteTarget(view, remotePath);
  if (!destination.ok) {
    yield errorLine(
      `[-] ${WRITE_DENY[destination.error]} (as ${outcome.tier}): ${resolveAbsPath(view.cwd(), remotePath)}`,
    );
    return 1;
  }
  // An overwrite leaves the file's own owner alone; a new file takes the tier's actor.
  // Restamping an existing file's owner would quietly re-own a root's file to whoever wrote
  // it, handing away more than the bytes.
  const existingOwner = destination.isNew ? undefined : view.stat(destination.target)?.owner;
  const result = await env.patches.write(destination.target, source.content, {
    owner: existingOwner ?? actor,
    ...(destination.isNew
      ? { isNew: true, permissions: defaultFilePermissions(outcome.tier) }
      : {}),
  });
  if (!result.ok) {
    yield errorLine(`[-] Write failed: ${PATCH_ERROR_REASON[result.error]}`);
    return 1;
  }

  yield text(
    `[+] Wrote ${source.content.length} bytes to ${destination.target} (as ${outcome.tier})`,
  );
  return 0;
}

/** A script roll: run the player's own script against THIS box at the granted tier. The
 *  writes it makes are re-walked at that tier and landed — a write the tier can make lands,
 *  one it cannot is dropped — exactly as the server re-walks a script's writes. Nothing is
 *  pushed and nothing is read back: which writes landed would answer a question about the
 *  box's permissions the player never got to ask. `actor` owns any file a write creates. */
async function* fireLocalScriptExec(
  env: CommandEnv,
  command: string,
  outcome: LocalExploitOutcome,
  path: string | undefined,
  actor: string,
): AsyncGenerator<TerminalLine, number> {
  yield* localPreamble(env, command, outcome);

  // Nothing named to run: the fire that REVEALS the effect, since a scan never says a CVE
  // runs a script. Names the hole, asks for one, and leaves nothing behind.
  if (path === undefined) {
    yield errorLine(`[-] this exploit runs a script — name one: ${USAGE_LOCAL_READ}`);
    return 1;
  }
  // The script is the player's OWN file, read at their own shell tier — a file this shell
  // cannot read is refused as their own typo rather than the box holding out.
  const script = env.fs.read(resolveAbsPath(env.fs.cwd(), path));
  if (!script.ok) {
    yield errorLine(`msfconsole: ${path}: ${LOCAL_READ_DENY[script.error]}`);
    return 1;
  }

  yield text('[+] Exploit successful!');

  // Collect the writes the script proposes, then re-walk each at the granted tier and land
  // it. A run that throws partway still had whatever it wrote first collected, so those land
  // before the error is told — a side effect that reached the box cannot be unwound.
  const collected: { path: string; content: string }[] = [];
  const run = await runScript(script.content, {
    fs: targetScriptFs(env.fs.root(), collected, outcome.tier),
  });
  const view = createFsView(env.fs.root(), { userType: outcome.tier, cwd: env.fs.cwd() });
  for (const write of collected) {
    const destination = resolveWriteTarget(view, write.path);
    if (!destination.ok) continue;
    const existingOwner = destination.isNew ? undefined : view.stat(destination.target)?.owner;
    const result = await env.patches.write(destination.target, write.content, {
      owner: existingOwner ?? actor,
      ...(destination.isNew
        ? { isNew: true, permissions: defaultFilePermissions(outcome.tier) }
        : {}),
    });
    if (!result.ok) {
      yield errorLine(`[-] Script injection failed: ${PATCH_ERROR_REASON[result.error]}`);
      return 1;
    }
  }

  if (!run.ok) {
    yield errorLine(`[-] Script injection failed: ${describeScriptError(run.error)}`);
    return 1;
  }

  yield text(`[+] Script injected on ${env.hostname} as ${outcome.tier}`);
  return 0;
}

/**
 * `msfconsole --local <command>`: fire the CVE a library the command links carries, on
 * the box the player is standing on. Everything is read from the box's OWN manifest and
 * the world clock, so what `apt list -u` forecasts and what `--local` lands agree.
 */
const executeLocal = async (
  env: CommandEnv,
  command: string | undefined,
  path: string | undefined,
): Promise<CommandResult> => {
  if (command === undefined) return errorResult(USAGE_LOCAL);

  // Another player's workstation is server-side state this side cannot regenerate, so the
  // client interpreter would have nothing to read. Refused before it runs, as `su` routes
  // that box to the server — the routed `--local` path is a later slice.
  const wlan0 = connectedWlan0(env.network);
  const essid = wlan0 === null ? null : wlan0.association.essid;
  if (
    isCrossPlayerWorkstation({
      machineId: env.session.machineId,
      publicKeyHex: env.identity.publicKeyHex,
      essid,
    })
  ) {
    return errorResult(LOCAL_CROSS_PLAYER);
  }

  const gameDay = gameDayAt(env.now());
  const versions = parseDpkgVersions(readDpkgStatus(env.fs.root()));
  // A library whose `.so` was deleted can't be fired through even if the manifest still
  // remembers it — the linker could no longer load it. Drop it from the candidate set so
  // it reads as the uniform miss, the way a missing binary makes a command not-found.
  const loadable = new Map(
    [...versions].filter(([pkg]) => {
      const library = SYSTEM_LIBRARIES.find((candidate) => candidate === pkg);
      return library === undefined || libraryPresent(env, library);
    }),
  );
  const outcome = localExploitOutcome(command, loadable, gameDay);
  if (outcome === undefined) return errorResult(localMiss(command));

  // The account the granted tier names, if the box holds one. Needed as the OWNER a write
  // stamps on a file it creates, and as the identity a shell or a reset stands on. A write
  // aims at a path, not a person, so it falls back to the tier itself when no account
  // exists — the router class runs the write hole and holds only root.
  const account = accountsIn(env.fs.root()).find((candidate) => candidate.userType === outcome.tier);
  const actor = account?.username ?? outcome.tier;

  // Path-aimed holes answer whether or not the box holds an account at the granted tier:
  // they act on a file or directory rather than on a person.
  if (outcome.effect === 'file_read') {
    return streamedResult(fireLocalFileRead(env, command, outcome, path));
  }
  if (outcome.effect === 'dir_list') {
    return streamedResult(fireLocalDirList(env, command, outcome, path));
  }
  if (outcome.effect === 'file_write') {
    return streamedResult(fireLocalFileWrite(env, command, outcome, path, actor));
  }
  if (outcome.effect === 'script_exec') {
    return streamedResult(fireLocalScriptExec(env, command, outcome, path, actor));
  }

  // Everything below stands the player as an account or turns an account's lock, so the box
  // must hold somebody at the granted tier. No such account is the uniform miss, refused
  // before any phase is streamed so it reads like every other bounce.
  if (account === undefined) return errorResult(localMiss(command));

  if (outcome.effect === 'shell_full' || outcome.effect === 'shell_limited') {
    return streamedResult(fireLocalShell(env, command, outcome, account));
  }
  if (outcome.effect === 'password_reset') {
    return streamedResult(fireLocalPasswordReset(env, command, outcome, account));
  }
  // The last kind, so no further guard: a backdoor opens a door on the box at the tier.
  return streamedResult(fireLocalBackdoor(env, command, outcome, account));
};

const execute: Command['execute'] = async (env, args, flags) => {
  if (flags.has('--local')) return executeLocal(env, args[0], args[1]);

  const [rawTarget, rawPort, rawArg] = args;
  if (rawTarget === undefined || rawPort === undefined) return errorResult(USAGE);
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) return errorResult(USAGE);

  const wlan0 = connectedWlan0(env.network);
  if (wlan0 === null) {
    return errorResult(connectFailure(rawTarget, port, 'Network is unreachable'));
  }
  const essid = wlan0.association.essid;

  // Read ONCE and used twice — to turn a name into an address, and then to ask whether
  // that address is a player's. Two reads could answer differently between the two uses,
  // and the second answer is the one that decides whether this fires at all.
  const occupants = await env.scan.resolveOccupants(essid);

  // A name becomes an address before anything routes on it, exactly as it does for
  // `ssh` — a scan prints `web-04` and that is what a player types next.
  const targetIp = await addressForTarget({
    essid,
    target: rawTarget,
    resolveOccupants: async () => occupants,
  });

  // The two vantages that are NOT on the generated LAN, and that this side therefore
  // cannot answer for. A public address names somebody else's access point, and whether a
  // forward points at a live box behind it is server-side state. A fellow occupant leases
  // an octet the generator never filled, so the generated world says "nobody" about a box
  // that is really standing there — the same precedence `nmap`, `ssh` and `nc` already
  // answer by. Refusing either here would shut the door from the inside, whatever the
  // server is willing to open.
  const offGeneratedLan =
    isPublicIp(targetIp) || occupants.some((occupant) => occupant.localIp === targetIp);

  // Everything else is the deterministic LAN, so an address nothing answers to is
  // answerable here: firing anyway would spend a round trip to be told what this side
  // already knew.
  const host = offGeneratedLan
    ? undefined
    : generateHomeLan(essid).hosts.find((candidate) => candidate.ip === targetIp);
  if (!offGeneratedLan && host === undefined) {
    return errorResult(connectFailure(targetIp, port, 'No route to host'));
  }

  // The tree a blind script runs against. Only a box this side can REGENERATE has one:
  // another player's is rebuilt server-side from THEIR identity and THEIR journal, so
  // there is nothing here to read it from. An empty tree keeps the hole working — the
  // writes still travel and are re-walked at the granted tier over there — at the same
  // fidelity cost this run already carries on a generated box, where it sees the box as
  // it shipped rather than as it stands.
  const baseFs =
    host === undefined
      ? dir({}, defaultDirectoryPermissions('user'))
      : resolveLanHostIdentity(host, essid).baseFs;

  // A `local:remote` token aims a WRITE, and its local half names a file on THIS box.
  // Read here rather than on the server, which regenerates the target and has no view of
  // this filesystem — through the same tier-scoped view `cat` reads, so a file this shell
  // cannot have is not one the exploit can send. Read blind: the scan never says which
  // effect a CVE carries, so any pair-shaped token is read in case the hole writes.
  const localPath = rawArg === undefined ? undefined : localHalfOf(rawArg);
  const local =
    localPath === undefined ? undefined : env.fs.read(resolveAbsPath(env.fs.cwd(), localPath));

  // A BARE token is read here too, and for the opposite reason the pair above is. A pair's
  // local half is certainly ours; a bare path is a file on the TARGET for the read holes
  // and a file on THIS box for the script hole, and nothing on this side can tell which it
  // is holding until the server names the effect. So it is read blind and a failure is
  // CARRIED rather than refused — refusing would stop every blind read aimed at a path this
  // box happens not to have, before it ever reached the network.
  const bareLocal =
    rawArg === undefined || localPath !== undefined
      ? undefined
      : env.fs.read(resolveAbsPath(env.fs.cwd(), rawArg));

  // Run BLIND, for the reason the read above is blind: the effect is not known until the
  // server answers, so any bare token this box could read is executed in case the hole
  // turns out to run one. It costs nothing when it does not — every other branch ignores
  // the writes, the run reaches only the target's regenerated tree and never this box, and
  // the failure is carried rather than printed, so a read hole aimed at a file that happens
  // to be valid JavaScript never reports a script error nobody asked for.
  const collected: { path: string; content: string }[] = [];
  const scriptRun =
    bareLocal !== undefined && bareLocal.ok
      ? await runScript(bareLocal.content, { fs: targetScriptFs(baseFs, collected) })
      : undefined;

  // Refused HERE rather than fired and failed. Nothing reached the daemon, so the target
  // is owed no line about it — the same rule the server keeps for a read fired with no
  // path. A player who mistyped their OWN path is told so without spending a break-in on
  // somebody else's log to find out.
  if (localPath !== undefined && local !== undefined && !local.ok) {
    return errorResult(`msfconsole: ${localPath}: ${LOCAL_READ_DENY[local.error]}`);
  }

  return streamedResult(
    fire(env, {
      targetIp,
      port,
      essid,
      arg: rawArg,
      content: local !== undefined && local.ok ? local.content : undefined,
      localError: bareLocal !== undefined && !bareLocal.ok ? bareLocal.error : undefined,
      // Present whenever a script RAN, even when it wrote nothing: having reached the box
      // and left it alone is a real outcome, and sending nothing would reach the server as
      // the entirely different fire that had nothing to run at all.
      writes: scriptRun === undefined ? undefined : collected,
      scriptError:
        scriptRun !== undefined && !scriptRun.ok ? describeScriptError(scriptRun.error) : undefined,
    }),
  );
};

export const msfconsole: Command = {
  name: 'msfconsole',
  description: 'Exploit a known vulnerability on a network service',
  category: 'network',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  flags: { '--local': 'boolean' },
  manual: {
    synopsis: 'msfconsole <host> <port> [path | local:remote]\n       msfconsole --local <command>',
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
      'which is then yours to use wherever that account is taken. A backdoor hole takes none ' +
      'either: it leaves a listener running on a port of its own choosing and tells you which, ' +
      'and that door stays open long after the break-in is forgotten. A write hole wants a ' +
      'PAIR as its third argument — "local:remote" — and plants the contents of a file on ' +
      'your own box at the path you name on theirs, at the tier the severity granted. It ' +
      'reads your file before it fires, so a local path you cannot read stops it before the ' +
      'target ever hears from you, and a file its tier cannot have over there comes back ' +
      'refused with the break-in already written down. ' +
      'Find a candidate with "nmap -sV", ' +
      'which reports the version and names ' +
      'the vulnerability when one has been published, but never what it does — firing is ' +
      'what reveals that. A service that is up to date refuses, and the target writes ' +
      'down that you tried. ' +
      'With "--local" the target is not a service but a command on the box you are already ' +
      'standing on — your own or one you hold. If a shared library the command links has a ' +
      'live vulnerability, the command gives itself up with no password, exactly as a service ' +
      'does: most holes hand over a shell at a tier that follows the severity — a critical or ' +
      'high hole as root, a lesser one as an ordinary user — while the rest act on the box ' +
      'itself the way they would on a target, reading or listing a path you name, planting a ' +
      'file from a "local:remote" pair, resetting the account that tier names, opening a ' +
      'backdoor port, or running a script you name. See what a command links with "ldd", and ' +
      'which of those libraries is exposed with "apt list -u". A command with no exposed ' +
      'library refuses.',
    arguments: [
      { name: 'host', description: 'Target host IP or name on your network', required: true },
      { name: 'port', description: 'The port the vulnerable service listens on', required: true },
      {
        name: 'path',
        description:
          'For a read hole, the file or directory to read. For a write hole, a "local:remote" ' +
          'pair — the file on your box, and where to put it on theirs. The exploit asks for ' +
          'whichever it needs if omitted',
        required: false,
      },
    ],
    examples: [
      { command: 'msfconsole 192.168.1.5 22', description: 'Exploit the ssh service on a host' },
      { command: 'msfconsole web-04 80', description: 'Exploit a web server by its name' },
      {
        command: 'msfconsole 192.168.1.1 161 /home/me/note.txt:/tmp/note.txt',
        description: 'Plant a file from your own box onto a router through its SNMP hole',
      },
      {
        command: 'msfconsole --local su',
        description: 'Escalate a shell through a live vulnerability in a library su links',
      },
    ],
  },
  execute,
};
