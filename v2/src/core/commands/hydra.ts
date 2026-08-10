/**
 * hydra — recover account passwords on a network service by wordlist attack.
 *
 * The player-facing half of the credential layer. What can be cracked is decided
 * entirely SERVER-side (`handleHydraCrack`): the same `/etc/passwd` `ssh`
 * validates against, swept against the wordlist on the box the player is standing
 * on. This command resolves the target, streams the attempt, and reports what
 * came back — it never decides an outcome itself, so hydra and `ssh` cannot
 * disagree about a credential.
 *
 * It runs wherever the player stands. A rooted box with hydra installed on it is a
 * place to attack FROM, so there is no "not your machine" refusal here: the command
 * names the machine it is running on and the server decides whether the caller may
 * read that box's wordlist — the same rule a write from the same shell obeys.
 *
 * Two things a player must be able to tell apart, so they are separate lines: a
 * target that held (their wordlist was not enough) and a target that was never
 * attacked (no service, no route, no wordlist). Reporting nothing for both would
 * make a broken setup look like a strong password.
 *
 * Pacing follows `aircrack`: the attempt is streamed through the abort-aware
 * `env.sleep`, so Ctrl-C stops a run rather than letting it finish invisibly.
 */

import type { Command, CommandEnv, CommandResult, TerminalLine } from './types';
import { connectedWlan0 } from '../network/interfaces';
import { isPublicIp } from '../generation/ip';

const error = (message: string): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content: message }],
  exitCode: 1,
});

const text = (content: string): TerminalLine => ({ kind: 'text', content });

const STEP_DELAY_MS = 220;
const DEFAULT_SERVICE = 'ssh';

/** What a refusal from the server means in the player's terms. Each names the
 *  thing to change, because "attack failed" is the one message that teaches
 *  nothing. */
const REFUSALS: Readonly<Record<string, string>> = {
  host_unreachable: 'no route to host — is it up, and on your network?',
  service_not_running: 'no such service on that host — scan it first with nmap',
  no_session: 'you are not logged in on this machine any more — reconnect and retry',
  caller_not_on_lan: 'cannot attack from this machine — it is not on your network',
  wordlist_lookup_failed: 'could not read your wordlist — try again',
  patches_lookup_failed: 'could not reach the target — try again',
};

/** `-p <port>`, or undefined when absent, valueless or not a port. Undefined means
 *  the default door, which behind a public IP is the gateway's own sshd. A bare `-p`
 *  yields `true` and an absent one `undefined` — both non-strings, so one guard
 *  covers them. */
const parsePort = (raw: string | true | undefined): number | undefined => {
  if (typeof raw !== 'string') return undefined;
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 ? port : undefined;
};

async function* attack(
  env: CommandEnv,
  target: string,
  service: string,
  username: string | undefined,
  callerMachineId: string,
  essid: string,
  sourceIp: string | null,
  port: number | undefined,
): AsyncIterable<TerminalLine> {
  yield text(`Hydra starting attack on ${service}://${target}`);
  await env.sleep(STEP_DELAY_MS);
  yield text(
    username === undefined
      ? 'Enumerating accounts from the target...'
      : `Targeting login: ${username}`,
  );
  await env.sleep(STEP_DELAY_MS);
  yield text('Loading /usr/share/wordlists/passwords.txt ...');
  await env.sleep(STEP_DELAY_MS);

  // A public IP is not a host on the player's own LAN: it names an ACCESS POINT,
  // and the port decides what behind it is reached — so it resolves server-side,
  // exactly as `ssh` resolves one. That action derives the source address itself,
  // because a trace on a foreign box is the defender's only evidence.
  //
  // `-p` goes only that way. On the player's own LAN a host IS the machine, and the
  // service name already selects whichever port its daemon listens on — there is no
  // forward table to address, so the flag has nothing to say.
  const result = isPublicIp(target)
    ? await env.hydra.crackPublic({ essid, target, service, username, callerMachineId, port })
    : await env.hydra.crack({ essid, target, service, username, callerMachineId, sourceIp });

  if (!result.ok) {
    yield { kind: 'error', content: `hydra: ${REFUSALS[result.error] ?? result.error}` };
    return;
  }

  if (!result.wordlistFound) {
    yield { kind: 'error', content: 'hydra: no wordlist — reinstall with: apt install hydra' };
    return;
  }

  await env.sleep(STEP_DELAY_MS);
  yield text('');
  for (const credential of result.cracked) {
    yield text(
      `[${result.port}][${service}] host: ${target}   login: ${credential.username}   password: ${credential.password}`,
    );
  }
  yield text('');
  yield text(
    result.cracked.length === 0
      ? '0 valid passwords found — nothing in your wordlist matched'
      : `${result.cracked.length} valid password(s) found`,
  );
}

const execute: Command['execute'] = async (env, args, flags) => {
  const [target, service, username] = args;
  if (target === undefined) {
    return error('hydra: missing target — usage: hydra [-p port] <host> [service] [user]');
  }

  const wlan0 = connectedWlan0(env.network);
  if (wlan0 === null) {
    return error('hydra: no route to host — you are not connected to a network');
  }

  return {
    kind: 'async',
    lines: attack(
      env,
      target,
      service ?? DEFAULT_SERVICE,
      username,
      env.session.machineId,
      wlan0.association.essid,
      wlan0.ipv4,
      parsePort(flags.get('-p')),
    ),
    exitCode: async () => 0,
  };
};

export const hydra: Command = {
  name: 'hydra',
  description: 'Crack account passwords on a network service',
  category: 'network',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  flags: { '-p': 'string' },
  manual: {
    synopsis: 'hydra [-p port] <host> [service] [user]',
    description:
      'Attempt to recover account passwords on a host by trying every password in your ' +
      'wordlist (/usr/share/wordlists/passwords.txt) against the service. With no user ' +
      'named, every account on the target is attacked. A password that is not in your ' +
      'wordlist will never be found, however weak it is — grow the list by editing it ' +
      'with nano as you harvest passwords elsewhere. A public IP is the access point ' +
      'that bears it, so attacking one attacks that network’s gateway — use "-p" to ' +
      'reach a machine somebody has published behind it instead. On your own network ' +
      'the service name already picks the port, so "-p" is only for a public IP.',
    arguments: [
      {
        name: 'host',
        description: 'Target host IP — one on your network, or a public IP',
        required: true,
      },
      { name: 'service', description: 'The service to attack (default ssh)' },
      { name: 'user', description: 'Attack only this account instead of every account' },
    ],
    examples: [
      { command: 'hydra 192.168.1.5', description: 'Attack every account over ssh' },
      { command: 'hydra 192.168.1.5 ssh root', description: 'Attack only the root account' },
      { command: 'hydra 203.0.113.7', description: "Attack a stranger's gateway over ssh" },
      {
        command: 'hydra -p 5544 203.0.113.7',
        description: 'Attack the machine behind a forwarded port',
      },
    ],
  },
  execute,
};
