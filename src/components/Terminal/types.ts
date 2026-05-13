import type { ShellContext } from '../../shell/types';
import type { AuthMethod } from '../../sessionRegistry/types';

export type AuthorLink = {
  readonly label: string;
  readonly url: string;
};

export type AuthorData = {
  readonly __type: 'author';
  readonly name: string;
  readonly description: readonly string[];
  readonly avatar: string;
  readonly links: readonly AuthorLink[];
};

export type PasswordPromptData = {
  readonly __type: 'password_prompt';
  readonly targetUser: string;
};

export type SshPromptData = {
  readonly __type: 'ssh_prompt';
  readonly targetUser: string;
  readonly targetIP: string;
  readonly targetPort: number;
  readonly password?: string;
};

export type ClearOutput = {
  readonly __type: 'clear';
};

export type ExitOutput = {
  readonly __type: 'exit';
};

export type FtpPromptData = {
  readonly __type: 'ftp_prompt';
  readonly targetIP: string;
  readonly username?: string;
  readonly password?: string;
};

export type FtpQuitOutput = {
  readonly __type: 'ftp_quit';
};

export type NcPromptData = {
  readonly __type: 'nc_prompt';
  readonly targetIP: string;
  readonly targetPort: number;
  readonly service: string;
  readonly username: string;
  readonly userType: 'root' | 'user' | 'guest';
  readonly homePath: string;
  // Distinguishes the two callers that yield NcPromptData:
  //   - 'pidfile' — `nc <ip> <port>` connecting to a `nc -l` listener.
  //                 Terminal routes through authCreateNcSession; server
  //                 reads /var/run/nc-<port>.pid and derives credentials.
  //   - 'effect'  — msfconsole `shell_limited` CVE result. No pidfile;
  //                 server-trust is handled via the effect-grant flow.
  //                 Terminal keeps the existing fire-and-forget
  //                 enterNcMode path.
  readonly proof: 'pidfile' | 'effect';
};

export type NcQuitOutput = {
  readonly __type: 'nc_quit';
};

export type ExploitShellData = {
  readonly __type: 'exploit_shell';
  readonly targetIP: string;
  readonly targetPort: number;
  readonly service: string;
  readonly username: string;
  readonly userType: 'root' | 'user' | 'guest';
  readonly homePath: string;
  readonly tier: 'root' | 'user' | 'guest';
};

export type MysqlPromptData = {
  readonly __type: 'mysql_prompt';
  readonly targetIP: string;
  readonly username: string;
  readonly password?: string;
};

export type MysqlQuitOutput = {
  readonly __type: 'mysql_quit';
};

export type RedisPromptData = {
  readonly __type: 'redis_prompt';
  readonly targetIP: string;
  readonly password?: string;
};

export type RedisQuitOutput = {
  readonly __type: 'redis_quit';
};

export type NanoOpenData = {
  readonly __type: 'nano_open';
  readonly filePath: string;
};

export type ScpPromptData = {
  readonly __type: 'scp_prompt';
  readonly targetUser: string;
  readonly targetIP: string;
  readonly targetPort: number;
  // Auth method is filled in by the SCP prompt handler (saved-key
  // fingerprint if the source machine has one, else the password the
  // user typed) and forwarded to the server-authoritative
  // authCreateSession via withTransientAuthSession.
  readonly performTransfer: (auth: AuthMethod) => AsyncOutput;
  readonly password?: string;
};

export type AsyncFollowUp =
  | SshPromptData
  | FtpPromptData
  | NcPromptData
  | ExploitShellData
  | ScpPromptData
  | MysqlPromptData
  | RedisPromptData;

export type AsyncOutput = {
  readonly __type: 'async';
  readonly start: (
    onLine: (line: string) => void,
    onComplete: (followUp?: AsyncFollowUp) => void,
  ) => void;
  readonly cancel?: () => void;
  readonly clearScreen?: true;
  // Spinner label override. When unset, the Terminal falls back to the
  // first token of the triggering command. Set by producers that don't
  // originate from a shell command (auth flows after a password prompt).
  readonly label?: string;
};

// Discriminated union for special command results
export type SpecialOutput =
  | AuthorData
  | PasswordPromptData
  | SshPromptData
  | ScpPromptData
  | ClearOutput
  | ExitOutput
  | FtpPromptData
  | FtpQuitOutput
  | NcPromptData
  | NcQuitOutput
  | ExploitShellData
  | MysqlPromptData
  | MysqlQuitOutput
  | RedisPromptData
  | RedisQuitOutput
  | NanoOpenData
  | AsyncOutput;

export type OutputLine =
  | {
      readonly id: number;
      readonly type: 'command' | 'result' | 'error' | 'banner';
      readonly content: string;
      readonly prompt?: string;
    }
  | {
      readonly id: number;
      readonly type: 'author';
      readonly content: AuthorData;
    };

export type CommandArgument = {
  readonly name: string;
  readonly description: string;
  readonly required?: boolean;
  // Discrete set of valid values for this argument slot. Used by tab completion
  // to offer keywords at the first arg position (e.g., apt install/list/upgrade).
  readonly values?: readonly string[];
};

export type CommandExample = {
  readonly command: string;
  readonly description: string;
};

export type CommandManual = {
  readonly synopsis: string;
  readonly description: string;
  readonly arguments?: readonly CommandArgument[];
  readonly examples?: readonly CommandExample[];
};

export type CommandCategory = 'general' | 'mission' | 'filesystem' | 'network' | 'wifi';

export type Command = {
  readonly name: string;
  readonly category: CommandCategory;
  readonly description: string;
  readonly manual?: CommandManual;
  readonly fn: (...args: unknown[]) => unknown;
  // Optional opt-in for shell features (stdin, future env/stderr). When a pipeline
  // provides shell context and the command defines fnShell, the executor prefers it.
  readonly fnShell?: (ctx: ShellContext, ...args: unknown[]) => unknown;
};

// Type guards for discriminated unions
export const isSpecialOutput = (value: unknown): value is SpecialOutput =>
  typeof value === 'object' && value !== null && '__type' in value;

export const isAuthorData = (value: unknown): value is AuthorData =>
  isSpecialOutput(value) && value.__type === 'author';

export const isPasswordPrompt = (value: unknown): value is PasswordPromptData =>
  isSpecialOutput(value) && value.__type === 'password_prompt';

export const isSshPrompt = (value: unknown): value is SshPromptData =>
  isSpecialOutput(value) && value.__type === 'ssh_prompt';

export const isClearOutput = (value: unknown): value is ClearOutput =>
  isSpecialOutput(value) && value.__type === 'clear';

export const isExitOutput = (value: unknown): value is ExitOutput =>
  isSpecialOutput(value) && value.__type === 'exit';

export const isFtpPrompt = (value: unknown): value is FtpPromptData =>
  isSpecialOutput(value) && value.__type === 'ftp_prompt';

export const isFtpQuit = (value: unknown): value is FtpQuitOutput =>
  isSpecialOutput(value) && value.__type === 'ftp_quit';

export const isAsyncOutput = (value: unknown): value is AsyncOutput =>
  isSpecialOutput(value) && value.__type === 'async';

export const isNcPrompt = (value: unknown): value is NcPromptData =>
  isSpecialOutput(value) && value.__type === 'nc_prompt';

export const isExploitShell = (value: unknown): value is ExploitShellData =>
  isSpecialOutput(value) && value.__type === 'exploit_shell';

export const isNcQuit = (value: unknown): value is NcQuitOutput =>
  isSpecialOutput(value) && value.__type === 'nc_quit';

export const isNanoOpen = (value: unknown): value is NanoOpenData =>
  isSpecialOutput(value) && value.__type === 'nano_open';

export const isScpPrompt = (value: unknown): value is ScpPromptData =>
  isSpecialOutput(value) && value.__type === 'scp_prompt';

export const isMysqlPrompt = (value: unknown): value is MysqlPromptData =>
  isSpecialOutput(value) && value.__type === 'mysql_prompt';

export const isMysqlQuit = (value: unknown): value is MysqlQuitOutput =>
  isSpecialOutput(value) && value.__type === 'mysql_quit';

export const isRedisPrompt = (value: unknown): value is RedisPromptData =>
  isSpecialOutput(value) && value.__type === 'redis_prompt';

export const isRedisQuit = (value: unknown): value is RedisQuitOutput =>
  isSpecialOutput(value) && value.__type === 'redis_quit';
