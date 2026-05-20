import type { Command, AsyncOutput, SshPromptData } from '../components/Terminal/types';
import type { RemoteMachine } from '../network/types';
import { createCancellationToken, jitter } from '../utils/asyncCommand';

type SshContext = {
  readonly getMachine: (ip: string) => RemoteMachine | undefined;
  // Async sibling of getMachine. Triggers the cross-LAN seed-regen
  // resolver when the target IP is a publicly-addressable IPv4 that
  // the sync view doesn't know yet. Optional for legacy callers /
  // single-player tests; when omitted, the command keeps the pre-
  // extension synchronous-throw contract on a sync miss.
  readonly findMachineByIpAsync?: (ip: string) => Promise<RemoteMachine | undefined>;
  readonly getLocalIP: () => string;
};

const SSH_CONNECT_DELAY_MS = 800;
const SSH_HANDSHAKE_DELAY_MS = 600;

// Parses "user@host" into components
const parseTarget = (target: string): { readonly user: string; readonly host: string } | null => {
  const atIndex = target.indexOf('@');
  if (atIndex < 1) return null;
  const user = target.slice(0, atIndex);
  const host = target.slice(atIndex + 1);
  if (!host) return null;
  return { user, host };
};

export const createSshCommand = (context: SshContext): Command => ({
  name: 'ssh',
  category: 'network',
  description: 'Secure shell connection to remote host',
  manual: {
    synopsis: 'ssh <user@host> [port] [password]',
    description:
      'Connect to a remote machine via SSH. Without a password, you will be prompted interactively. ' +
      'With a password, authentication happens automatically after the connection animation — useful in scripts via node. ' +
      'Default port is 22.',
    arguments: [
      {
        name: 'target',
        description: 'Connection string in user@host format',
        required: true,
      },
      {
        name: 'port',
        description: 'Port to connect on (default: 22)',
        required: false,
      },
      {
        name: 'password',
        description: 'Optional password for programmatic authentication',
        required: false,
      },
    ],
    examples: [
      { command: 'ssh admin@192.168.1.1', description: 'Connect to gateway as admin' },
      {
        command: 'ssh root@10.0.0.5 2222',
        description: 'Connect on port 2222',
      },
      {
        command: 'ssh admin@192.168.1.1 secret',
        description: 'Connect with password (scripting)',
      },
    ],
  },
  fn: (...args: unknown[]): AsyncOutput => {
    const { getMachine, findMachineByIpAsync, getLocalIP } = context;

    const arg = args[0];
    if (typeof arg !== 'string' || !arg) {
      throw new Error('ssh: missing destination\nUsage: ssh <user@host>');
    }

    const parsed = parseTarget(arg);
    if (!parsed) {
      throw new Error(`ssh: invalid destination: '${arg}'\nUsage: ssh <user@host>`);
    }

    const { user, host } = parsed;

    // Overloaded args: ssh(target, password?) or ssh(target, port, password?).
    // Script callers may pass a number (strict validation); shell callers pass
    // strings and we interpret port-shaped integers as ports.
    const secondArg = args[1];
    const thirdArg = args[2];

    let port = 22;
    let password: string | undefined;

    if (typeof secondArg === 'number') {
      if (!Number.isInteger(secondArg) || secondArg < 1 || secondArg > 65535) {
        throw new Error(`ssh: invalid port '${String(secondArg)}'`);
      }
      port = secondArg;
      password = typeof thirdArg === 'string' ? thirdArg : undefined;
    } else if (typeof secondArg === 'string') {
      const asNum = Number(secondArg);
      const looksLikePort =
        secondArg.trim() !== '' && Number.isInteger(asNum) && asNum >= 1 && asNum <= 65535;
      if (looksLikePort) {
        port = asNum;
        password = typeof thirdArg === 'string' ? thirdArg : undefined;
      } else {
        password = secondArg;
      }
    }

    const localIP = getLocalIP();
    if (host === localIP || host === '127.0.0.1' || host === 'localhost') {
      throw new Error('ssh: cannot connect to localhost via SSH');
    }

    const token = createCancellationToken();

    // Validation that depends on the resolved machine. Split out so the
    // sync-hit fast path and the async-resolved fallback both run the
    // same gate. Throws are caught at the caller — sync path lets them
    // propagate as the existing throw contract; async path catches and
    // emits via onLine (the resolver round-trip is async, so a throw
    // can't reach the caller's try/catch in the original sync sense).
    const validateAndBuildPrompt = (machine: RemoteMachine | undefined): SshPromptData => {
      if (!machine) {
        throw new Error(`ssh: connect to host ${host} port ${port}: Connection refused`);
      }

      const targetPort = machine.ports.find((p) => p.port === port);
      if (!targetPort || !targetPort.open) {
        throw new Error(`ssh: connect to host ${host} port ${port}: Connection refused`);
      }

      // Fast-fail when we have a definitive view of the target's user
      // list (NPC home/world machines and the player's own workstation
      // populate machine.users from generation). For cross-player
      // occupants the placeholder rendering leaves users=[] until base
      // FS replication ships, so an empty list means "we don't know" —
      // defer to the server's authCreateSession check, which will
      // return 401 invalid_credentials for unknown usernames anyway
      // (no enumeration leak).
      //
      // ALSO skip the check for NAT-forwarded ports: the merged view's
      // users field carries the GATEWAY's users (router admins + NPC
      // forwarded internals), NOT the forwarded target's. A player
      // SSHing through `ssh user@<router.publicIp> <forwarded-port>`
      // authenticates against the forwarded workstation/NPC whose
      // /etc/passwd lives behind the gateway. Validating against the
      // gateway's users would spuriously block legitimate auth.
      const isForwardedTarget = targetPort.forwarded === true;
      if (
        !isForwardedTarget &&
        machine.users.length > 0 &&
        !machine.users.some((u) => u.username === user)
      ) {
        throw new Error(`ssh: ${user}@${host}: Permission denied (publickey,password)`);
      }

      return {
        __type: 'ssh_prompt',
        targetUser: user,
        targetIP: host,
        targetPort: port,
        ...(password !== undefined && { password }),
      };
    };

    // Shared animation + prompt dispatch. Used by both the sync-hit
    // path and the async-resolved path. The validation already ran
    // upstream and returned the SshPromptData; we just animate to the
    // prompt.
    const runAuthFlow = (
      onLine: (line: string) => void,
      onComplete: (followUp?: SshPromptData) => void,
      sshPrompt: SshPromptData,
    ) => {
      onLine(`Connecting to ${host}...`);

      token.schedule(() => {
        if (token.isCancelled()) return;

        onLine(`SSH-2.0-OpenSSH_8.9`);

        token.schedule(() => {
          if (token.isCancelled()) return;

          onLine(`Authenticating as ${user}...`);

          onComplete(sshPrompt);
        }, jitter(SSH_HANDSHAKE_DELAY_MS));
      }, jitter(SSH_CONNECT_DELAY_MS));
    };

    // Sync hit OR no async resolver wired: keep the legacy
    // synchronous-throw contract. Validation runs at fn() time so
    // tests asserting `() => ssh.fn(...)` throw continue to pass.
    const syncMachine = getMachine(host);
    if (syncMachine || !findMachineByIpAsync) {
      const sshPrompt = validateAndBuildPrompt(syncMachine);
      return {
        __type: 'async',
        start: (onLine, onComplete) => runAuthFlow(onLine, onComplete, sshPrompt),
        cancel: token.cancel,
      };
    }

    // Cross-LAN fallback: sync miss + async resolver available. The
    // animation can't start synchronously because the resolver is
    // awaited first — but downstream code expects an AsyncOutput
    // immediately, so we return an envelope whose start() does the
    // await and then runs the animation. Validation throws are
    // caught and surfaced via onLine, mirroring nmap's pattern.
    return {
      __type: 'async',
      start: (onLine, onComplete) => {
        void findMachineByIpAsync(host).then((asyncMachine) => {
          if (token.isCancelled()) return;
          try {
            const sshPrompt = validateAndBuildPrompt(asyncMachine);
            runAuthFlow(onLine, onComplete, sshPrompt);
          } catch (error) {
            onLine(error instanceof Error ? error.message : String(error));
            onComplete();
          }
        });
      },
      cancel: token.cancel,
    };
  },
});
