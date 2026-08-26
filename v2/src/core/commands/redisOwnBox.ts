/**
 * The key-value door from your own chair — the whole conversation, client side.
 *
 * Every other target goes through the server, because a client asking about somebody
 * else's box must not be trusted to answer its own question. Your own box has nothing to
 * protect from you: you are root on it, the datadir is a file you can open in an editor,
 * and the password you are typing is one you could read out of `/etc/passwd` first. So
 * the round trip buys nothing here and costs a request per line.
 *
 * It is also the only correct place for the answer. The server's same-LAN vantage
 * excludes the caller on purpose, so a self-addressed reach that went out would fall
 * through to the generated world and open whichever seeded box happens to stand at the
 * address this player was leased — reading a stranger's store, and writing to it.
 *
 * What differs from an attacker's path is WHERE the decision runs, never what it
 * decides. The daemon check, the arrival line and every statement's answer come from the
 * same readers and the same formatters `handleRedisConnect` and `handleRedisStatement`
 * use rather than being reimplemented, so a rule that changes changes for both vantages
 * at once.
 *
 * Those decisions are read off the machine as it stands RIGHT NOW rather than off the
 * tree this client is holding, and that is the one place the local vantage cannot take
 * the shortcut. A shell can trust its own copy because the player is the only one
 * editing it; the datadir and the log are not like that. A fellow occupant reaching this
 * box's daemon writes BOTH of them, under this owner's key, and nothing pushes that
 * here. Composing from the client's copy would not merely miss their write, it would
 * REVERT it — silently erasing an intruder's edits from the store and their visit from
 * the log, by the owner's own routine use of their own box.
 */

import { readOpenPorts } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { derivePid } from '../logging/syslog';
import {
  formatRedisConnectLine,
  formatRedisMutationLine,
  REDIS_LOG_OWNER,
  REDIS_LOG_PATH,
  REDIS_LOG_PERMISSIONS,
} from '../logging/redisLog';
import { DATADIR_FILE } from '../generation/baseFs';
import { storeIn, DATADIR_OWNER, DATADIR_PATH } from '../redis/datadir';
import { runStatement } from '../redis/statements';

import { asGameTime } from '../types';
import type {
  CommandEnv,
  FsView,
  RedisConnectParams,
  RedisConnectResult,
  RedisStatementParams,
  RedisStatementResult,
} from './types';

/** Whether the daemon is holding the port on a tree this client can see for itself. The
 *  pidfiles are the same source `nmap` reads, so a door the player was shown is a door
 *  that opens — and `systemctl stop redis` shuts this one too. */
export const storeListening = (fs: Parameters<typeof readOpenPorts>[0], port: number): boolean =>
  readOpenPorts(fs).some(
    (open) => open.port === port && open.service === SERVICE_CATALOG.redis.service,
  );

/**
 * Append one already-formatted line to the box's own `/var/log/redis.log`.
 *
 * The read comes first and a read that FAILED writes nothing, exactly as the server-side
 * appender bails: replacing a box's history with one line is a worse outcome than
 * dropping the line. An absent file is not that failure — it is the ordinary state of a
 * box whose daemon has not had anything to say yet, and the first line creates it.
 *
 * The view is passed in rather than taken from `env` because it has to be the RELOADED
 * one: this file is the defender's evidence, and evidence a visit of their own can
 * quietly shorten is none.
 */
const appendOwnLog = async (env: CommandEnv, view: FsView, line: string): Promise<void> => {
  const existing = view.read(REDIS_LOG_PATH);
  if (!existing.ok && existing.error !== 'not_found') return;

  const current = existing.ok ? existing.content : '';
  await env.patches.write(REDIS_LOG_PATH, `${current}${line}\n`, {
    owner: REDIS_LOG_OWNER,
    permissions: REDIS_LOG_PERMISSIONS,
    ...(existing.ok ? {} : { isNew: true }),
  });
};

/**
 * Open the store on your own box — the local half of `env.redis.connect`, answering in
 * the same shape so the command above it renders one greeting and one refusal.
 *
 * The daemon is re-checked here rather than trusted from the caller's pre-flight,
 * because a `systemctl stop` between the two is a door that closed while the player was
 * still typing, and it must not open anyway.
 *
 * Nothing about the LOCK is decided here, exactly as nothing about it is decided on the
 * wire: whether a store holds one costs a statement to find out, which is what stops the
 * open from telling a scanner which stores are worth a sweep.
 */
export const connectOwnStore = async (
  env: CommandEnv,
  params: RedisConnectParams,
): Promise<RedisConnectResult> => {
  const view = await env.fs.reload();
  if (!storeListening(view.root(), params.port)) return { ok: false, reason: 'refused' };

  // The arrival lands whether or not a password is ever named, because on an open store
  // it is the only line the visit will ever produce — and a daemon that recorded
  // strangers but not its owner would be one that knows which is which.
  const stamp = env.now();
  await appendOwnLog(
    env,
    view,
    formatRedisConnectLine({
      fromIp: params.sourceIp,
      time: asGameTime(stamp),
      pid: derivePid(stamp),
    }),
  );

  return { ok: true, hostname: env.hostname };
};

/**
 * Answer one statement against your own store — the local half of `env.redis.run`.
 *
 * Everything is re-read per statement, as the server re-reads it: the daemon, the store
 * itself, and the lock inside it. `lost` covers every way this box stops being one that
 * can answer, because from the prompt's side they are one condition — the daemon
 * stopped, the datadir deleted, or a write that could not be recorded. Answering over a
 * write that never landed would show the player their old keys on the next line.
 */
export const runOwnStatement = async (
  env: CommandEnv,
  params: RedisStatementParams,
): Promise<RedisStatementResult> => {
  const view = await env.fs.reload();
  const fs = view.root();
  if (!storeListening(fs, params.port)) return { kind: 'lost' };

  // Root's own file on root's own box: between two statements they can delete it,
  // truncate it, or paste something into it that is not a store. All three read the same
  // way from here, which is why the reader collapses them.
  const store = storeIn(fs);
  if (store === null) return { kind: 'lost' };

  const { output, failed, attempt, store: changed, logged } = runStatement({
    store,
    line: params.statement,
    ...(params.password === undefined ? {} : { password: params.password }),
  });

  if (changed !== undefined) {
    // The DAEMON's write, not the shell's: redis runs as root, and a rewrite inheriting
    // the player's tier would hand the box's ordinary user the hash a sweep is supposed
    // to have to work for.
    const written = await env.patches.write(DATADIR_PATH, JSON.stringify(changed), {
      owner: DATADIR_OWNER,
      permissions: DATADIR_FILE,
    });
    if (!written.ok) return { kind: 'lost' };
  }

  const stamp = env.now();

  // Only a password actually weighed leaves a mark of its own.
  if (attempt !== undefined) {
    await appendOwnLog(
      env,
      view,
      SERVICE_CATALOG.redis.sweepLog.formatAttempt({
        outcome: attempt,
        user: '',
        fromIp: params.sourceIp,
        hostname: env.hostname,
        time: asGameTime(stamp),
        pid: derivePid(stamp),
      }),
    );
  }

  // And only a statement that actually changed something. A line saying something
  // changed, written over a change that did not, sends a defender looking for an edit
  // nobody made.
  if (logged !== undefined) {
    await appendOwnLog(
      env,
      view,
      formatRedisMutationLine({
        detail: logged,
        fromIp: params.sourceIp,
        time: asGameTime(stamp),
        pid: derivePid(stamp),
      }),
    );
  }

  return { kind: 'answered', output, failed };
};
