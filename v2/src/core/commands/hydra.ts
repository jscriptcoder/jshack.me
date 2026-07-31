/**
 * hydra — recover account passwords on a network service by wordlist attack.
 *
 * The player-facing half of the credential layer. What can be cracked is decided
 * entirely SERVER-side (`handleHydraCrack`): the same `/etc/passwd` `ssh`
 * validates against, swept against the player's OWN wordlist read from their own
 * box. This command resolves the target, streams the attempt, and reports what
 * came back — it never decides an outcome itself, so hydra and `ssh` cannot
 * disagree about a credential.
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
import { isOwnWorkstation } from '../identity/workstation';

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
  not_own_machine: 'cannot read your wordlist — this is not your machine',
  wordlist_lookup_failed: 'could not read your wordlist — try again',
  patches_lookup_failed: 'could not reach the target — try again',
};

async function* attack(
  env: CommandEnv,
  target: string,
  service: string,
  username: string | undefined,
  callerMachineId: string,
  essid: string,
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

  const result = await env.hydra.crack({
    essid,
    target,
    service,
    username,
    callerMachineId,
  });

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

const execute: Command['execute'] = async (env, args) => {
  if (!isOwnWorkstation(env.session.machineId, env.identity.publicKeyHex)) {
    return error('hydra: command not available on this machine');
  }

  const [target, service, username] = args;
  if (target === undefined) {
    return error('hydra: missing target — usage: hydra <host> [service] [user]');
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
    ),
    exitCode: async () => 0,
  };
};

export const hydra: Command = {
  name: 'hydra',
  description: 'Crack account passwords on a network service',
  category: 'network',
  tier: 'guest',
  availability: { kind: 'localhost-only' },
  manual: {
    synopsis: 'hydra <host> [service] [user]',
    description:
      'Attempt to recover account passwords on a host by trying every password in your ' +
      'wordlist (/usr/share/wordlists/passwords.txt) against the service. With no user ' +
      'named, every account on the target is attacked. A password that is not in your ' +
      'wordlist will never be found, however weak it is — grow the list by editing it ' +
      'with nano as you harvest passwords elsewhere.',
    arguments: [
      { name: 'host', description: 'Target host IP on your network', required: true },
      { name: 'service', description: 'The service to attack (default ssh)' },
      { name: 'user', description: 'Attack only this account instead of every account' },
    ],
    examples: [
      { command: 'hydra 192.168.1.5', description: 'Attack every account over ssh' },
      { command: 'hydra 192.168.1.5 ssh root', description: 'Attack only the root account' },
    ],
  },
  execute,
};
