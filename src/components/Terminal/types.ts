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
};

export type NcQuitOutput = {
  readonly __type: 'nc_quit';
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
  readonly performTransfer: () => AsyncOutput;
  readonly password?: string;
};

export type AsyncFollowUp =
  | SshPromptData
  | FtpPromptData
  | NcPromptData
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
