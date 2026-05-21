import type { Command, AsyncOutput, FtpPromptData } from '../components/Terminal/types';
import type { RemoteMachine, DnsRecord } from '../network/types';
import { createCancellationToken, jitter } from '../utils/asyncCommand';

type FtpContext = {
  readonly getMachine: (ip: string) => RemoteMachine | undefined;
  // Async sibling of getMachine. Triggers the cross-LAN seed-regen
  // resolver when the target IP is a publicly-addressable IPv4 that
  // the sync view doesn't know yet. Optional for legacy callers /
  // single-player tests; when omitted, the command keeps the pre-
  // extension synchronous-throw contract on a sync miss.
  readonly findMachineByIpAsync?: (ip: string) => Promise<RemoteMachine | undefined>;
  readonly getLocalIP: () => string;
  readonly resolveDomain: (domain: string) => DnsRecord | undefined;
};

const FTP_CONNECT_DELAY_MS = 600;
const FTP_BANNER_DELAY_MS = 400;

export const createFtpCommand = (context: FtpContext): Command => ({
  name: 'ftp',
  category: 'network',
  description: 'File Transfer Protocol connection to remote host',
  manual: {
    synopsis: 'ftp <host> [username] [password]',
    description:
      'Connect to a remote machine via FTP. Without credentials, you will be prompted for username and password. ' +
      'With credentials, authentication happens automatically after the connection animation — useful in scripts via node. ' +
      'Once connected, you can use FTP commands: ls, cd, pwd, lpwd, lcd, get, put, quit.',
    arguments: [
      { name: 'host', description: 'IP address or hostname of the remote machine', required: true },
      {
        name: 'username',
        description: 'Optional username for programmatic authentication',
        required: false,
      },
      {
        name: 'password',
        description: 'Optional password for programmatic authentication',
        required: false,
      },
    ],
    examples: [
      { command: 'ftp 10.0.0.5', description: 'Connect to a remote host via FTP' },
      { command: 'ftp target.local', description: 'Connect using hostname' },
      {
        command: 'ftp 10.0.0.5 admin secret',
        description: 'Connect with credentials (scripting)',
      },
    ],
  },
  fn: (...args: unknown[]): AsyncOutput => {
    const { getMachine, findMachineByIpAsync, getLocalIP, resolveDomain } = context;

    const host = args[0] as string | undefined;
    const usernameArg = args[1] as string | undefined;
    const passwordArg = args[2] as string | undefined;

    if (!host) {
      throw new Error('ftp: missing host\nUsage: ftp <host>');
    }

    let targetIP = host;
    if (!host.match(/^\d+\.\d+\.\d+\.\d+$/)) {
      const record = resolveDomain(host);
      if (!record) {
        throw new Error(`ftp: ${host}: Name or service not known`);
      }
      targetIP = record.ip;
    }

    const localIP = getLocalIP();
    if (targetIP === localIP || targetIP === '127.0.0.1' || host === 'localhost') {
      throw new Error('ftp: cannot connect to localhost via FTP');
    }

    const token = createCancellationToken();

    // Validation that depends on the resolved machine. Split out so the
    // sync-hit fast path and the async-resolved fallback both run the
    // same gate. Throws are caught at the caller — sync path lets them
    // propagate as the legacy throw contract; async path catches and
    // emits via onLine (the resolver round-trip is async, so a throw
    // can't reach the caller's try/catch in the original sync sense).
    const validateAndBuildPrompt = (machine: RemoteMachine | undefined): FtpPromptData => {
      if (!machine) {
        throw new Error(`ftp: connect to ${targetIP} port 21: Connection refused`);
      }

      const ftpPort = machine.ports.find((p) => p.port === 21 && p.service === 'ftp');
      if (!ftpPort || !ftpPort.open) {
        throw new Error(`ftp: connect to ${targetIP} port 21: Connection refused`);
      }

      return {
        __type: 'ftp_prompt',
        targetIP,
        ...(usernameArg !== undefined && { username: usernameArg }),
        ...(passwordArg !== undefined && { password: passwordArg }),
      };
    };

    // Shared animation. The sync and async paths both end here once
    // validation has produced an FtpPromptData. machine.hostname is
    // baked into the 220 banner so the host shown matches the resolved
    // machine view (router vs occupant stub when cross-LAN forwarded).
    const runConnectAnim = (
      onLine: (line: string) => void,
      onComplete: (followUp?: FtpPromptData) => void,
      machineHostname: string,
      ftpPrompt: FtpPromptData,
    ) => {
      onLine(`Connecting to ${targetIP}...`);

      token.schedule(() => {
        if (token.isCancelled()) return;

        onLine(`Connected to ${targetIP}.`);

        token.schedule(() => {
          if (token.isCancelled()) return;

          onLine(`220 Welcome to ${machineHostname} FTP server.`);

          onComplete(ftpPrompt);
        }, jitter(FTP_BANNER_DELAY_MS));
      }, jitter(FTP_CONNECT_DELAY_MS));
    };

    // Sync hit OR no async resolver wired: keep the legacy
    // synchronous-throw contract. Validation runs at fn() time so
    // tests asserting `() => ftp.fn(...)` throw continue to pass.
    const syncMachine = getMachine(targetIP);
    if (syncMachine || !findMachineByIpAsync) {
      const ftpPrompt = validateAndBuildPrompt(syncMachine);
      return {
        __type: 'async',
        start: (onLine, onComplete) =>
          runConnectAnim(onLine, onComplete, syncMachine!.hostname, ftpPrompt),
        cancel: token.cancel,
      };
    }

    // Cross-LAN fallback: sync miss + async resolver available. The
    // animation can't start synchronously because the resolver is
    // awaited first — but downstream code expects an AsyncOutput
    // immediately, so we return an envelope whose start() does the
    // await and then runs the animation. Validation throws are
    // caught and surfaced via onLine, mirroring nmap + ssh.
    return {
      __type: 'async',
      start: (onLine, onComplete) => {
        void findMachineByIpAsync(targetIP).then((asyncMachine) => {
          if (token.isCancelled()) return;
          try {
            const ftpPrompt = validateAndBuildPrompt(asyncMachine);
            runConnectAnim(onLine, onComplete, asyncMachine!.hostname, ftpPrompt);
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
