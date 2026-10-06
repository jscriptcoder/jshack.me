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
 * Pacing follows `aircrack-ng`: the attempt is streamed through the abort-aware
 * `env.sleep`, so Ctrl-C stops a run rather than letting it finish invisibly.
 */

import type { Command, CommandEnv, CommandResult, TerminalLine } from './types.js';
import { vantageOf } from '../network/vantage.js';
import { serviceByName } from '../services/serviceCatalog.js';

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
  wrong_network: 'cannot attack from this machine — it is not on that network',
  caller_not_on_network: 'you are not on a network — connect first',
  no_password_set: 'that store has no password set (open access) — connect with redis-cli',
  wordlist_lookup_failed: 'could not read your wordlist — try again',
  patches_lookup_failed: 'could not reach the target — try again',
};

/** `-p <port>`, or undefined when absent, valueless or not a port. Undefined means
 *  the default door, which behind a public IP is the gateway's own agent for the named
 *  service — sshd for a bare `hydra <ip>`, snmpd for `hydra <ip> snmp`. A bare `-p`
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
  port: number | undefined,
): AsyncIterable<TerminalLine> {
  yield text(`Hydra starting attack on ${service}://${target}`);
  await env.sleep(STEP_DELAY_MS);
  // A door whose secret belongs to the SERVICE has no accounts to enumerate and no
  // login to target. Saying either would send the player hunting for a username that
  // does not exist — and the name they DID type still travels, because the server
  // answers it rather than filtering by it.
  yield text(
    serviceByName(service)?.secretOn !== undefined
      ? "This service has no logins — attacking the store's own password"
      : username === undefined
        ? 'Enumerating accounts from the target...'
        : `Targeting login: ${username}`,
  );
  await env.sleep(STEP_DELAY_MS);
  yield text('Loading /usr/share/wordlists/passwords.txt ...');
  await env.sleep(STEP_DELAY_MS);

  // ONE action for every target. Which box the address names — a host on the hop's own
  // LAN, a fellow occupant, a box on a deep layer behind one of the hop's gateways, or
  // whatever answers behind a public access point — is the server's to resolve through
  // the reach `ssh` and the data doors share, so hydra no longer splits the knock three
  // ways by guessing the route here. The port is forwarded as typed: absent is the named
  // service's default, and on an inner gateway a forwarded port still names the box on
  // the layer behind it, exactly as `ssh -p <fwd> <inner>` routes.
  const result = await env.hydra.crack({ essid, target, service, username, callerMachineId, port });

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
    // The login field is omitted entirely rather than left blank for a door that has
    // none: an empty column reads as an account whose name was lost.
    const login = credential.username === undefined ? '' : `login: ${credential.username}   `;
    yield text(
      `[${result.port}][${service}] host: ${target}   ${login}password: ${credential.password}`,
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

  // Where the shell stands: the hop on top of the stack and its network, or the
  // player's own WiFi on their own box. The radio stays with the body; a sweep follows
  // the shell, so the home card being off is no obstacle on a hop.
  const vantage = vantageOf(env.session, env.network);
  if (vantage === null) {
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
      vantage.essid,
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
      'wordlist (/usr/share/wordlists/passwords.txt) against the service, on the network ' +
      'you are on — your own at home, or the network of a box you have a shell on, so a ' +
      'sweep run from a remote shell comes from THAT box and not from home. With no user ' +
      'named, every account on the target is attacked. A password that is not in your ' +
      'wordlist will never be found, however weak it is — grow the list as you harvest ' +
      'passwords elsewhere, one at a time with "echo <password> >> ' +
      '/usr/share/wordlists/passwords.txt" or by editing it with nano. A public IP is the ' +
      'access point that bears it, so attacking one attacks that network’s gateway — use "-p" to ' +
      'reach a machine somebody has published behind it instead. "-p" also opens the ' +
      'layer hidden behind one of your own gateways: a port it forwards reaches a ' +
      'machine that has no address on your network at all. With no "-p", the service is ' +
      'attacked on its own default port (ssh 22, ftp 21, snmp 161); name the port with ' +
      '"-p" for a service listening anywhere else.',
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
      {
        command: 'hydra -p 2222 192.168.1.85',
        description: 'Attack a machine hidden behind your own gateway',
      },
    ],
  },
  execute,
};
