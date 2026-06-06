/**
 * The command contract.
 *
 * `CommandEnv` is THE BOUNDARY between framework-agnostic command code
 * and everything else (UI signals, adapters, server endpoints). A command
 * receives an env, args, and flags; returns a Promise<CommandResult>.
 *
 * Every dependency a command needs lives on `env`. Commands never reach
 * for globals, never import from `ui/`, never import from `adapters/`.
 * This is what lets the same command run in the browser, in a Node test
 * harness, or anywhere else.
 */

import type {
  AbsPath,
  EpochMs,
  GameTime,
  MachineId,
  NetworkAddress,
  PlayerKeyHex,
  UserType,
} from '../types';
import type { Directory, FileNode, FilePermissions } from '../filesystem/types';
import type { WalkResult } from '../filesystem/walker';
import type { NetworkInterface } from '../network/interfaces';
import type { HomeNetworkAssignment } from '../network/homeNetwork';
import type { WifiNetwork } from '../network/wifi';
import type { FlagSpec } from '../shell/bindFlags';

// ---- Identity & session (read-only snapshots in CommandEnv) ----

export type Identity = {
  readonly publicKeyHex: PlayerKeyHex;
  /** Hex-encoded private key. Never logged, never serialized. */
  readonly privateKeyHex: string;
};

export type SessionKind =
  | 'ssh'
  | 'su'
  | 'exploit'
  | 'effect_one_shot'
  | 'effect_password_reset'
  | 'nc'
  | 'ftp'
  | 'mysql'
  | 'redis'
  | 'mission';

export type Session = {
  readonly id: string;
  readonly playerKey: PlayerKeyHex;
  readonly machineId: MachineId;
  readonly username: string;
  readonly userType: UserType;
  readonly kind: SessionKind;
  readonly createdAt: EpochMs;
};

export type HopChain = readonly Session[];

// ---- Output ----

/** Lines emitted by a command. Discriminated for renderer dispatch. */
export type TerminalLine =
  | { readonly kind: 'text'; readonly content: string }
  | { readonly kind: 'error'; readonly content: string }
  | { readonly kind: 'dim'; readonly content: string }
  | { readonly kind: 'prompt'; readonly content: string };

// ---- Command result ----

/** A command can return either a fully-collected line set, a stream, or a
 *  request to enter a special UI mode (nano, lynx, nc shell, ftp, etc). */
export type CommandResult =
  | {
      readonly kind: 'sync';
      readonly lines: readonly TerminalLine[];
      readonly exitCode: number;
    }
  | {
      readonly kind: 'async';
      readonly lines: AsyncIterable<TerminalLine>;
      readonly exitCode: () => Promise<number>;
    }
  | {
      readonly kind: 'mode_change';
      readonly mode: ModeChange;
    };

export type ModeChange =
  | { readonly kind: 'nano'; readonly path: AbsPath; readonly content: string }
  | { readonly kind: 'lynx'; readonly url: string }
  | { readonly kind: 'nc'; readonly target: { readonly ip: NetworkAddress; readonly port: number } }
  | { readonly kind: 'ftp'; readonly target: { readonly ip: NetworkAddress } }
  | { readonly kind: 'mysql'; readonly target: { readonly ip: NetworkAddress } }
  | { readonly kind: 'redis'; readonly target: { readonly ip: NetworkAddress } };

// ---- Sub-API interfaces (the parts of CommandEnv) ----

/** Filesystem view of the CURRENT machine (session.machineId). */
export type FsView = {
  readonly cwd: () => AbsPath;
  readonly read: (path: AbsPath) => FsReadResult;
  readonly list: (path: AbsPath) => FsListResult;
  readonly stat: (path: AbsPath) => FileNode | null;
  /** Can the session tier write the node at `path` (create entries in a
   *  directory, or overwrite a file)? Mirrors the read side: resolves the
   *  path and runs the shared walker. Used by the write commands (mkdir,
   *  redirect, rm) to gate before routing through `PatchApi`. */
  readonly canWrite: (path: AbsPath) => WalkResult;
  /** Full directory snapshot for the current machine. Used by walker-based ops. */
  readonly root: () => Directory;
};

export type FsReadResult =
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly error: 'not_found' | 'permission_denied' | 'is_directory' };

export type FsListResult =
  | { readonly ok: true; readonly entries: readonly string[] }
  | { readonly ok: false; readonly error: 'not_found' | 'permission_denied' | 'not_a_directory' };

/** Mutation API. Routes through the patch model (L1/L2 on real adapter).
 *
 *  `write`'s `isNew` flag marks a genuinely-new file (no base-FS counterpart),
 *  so the server stamps `is_new: true` and a later `remove` deletes the row
 *  rather than leaving a tombstone. Callers know this from the FS view: an
 *  absent target (`stat === null`) is new; an existing target is an overwrite,
 *  where omitting the flag preserves the row's stored `is_new`.
 *
 *  `permissions` overrides the tier-derived default for the new node — used by
 *  `apt install` to stamp a world-executable binary (the default file perms are
 *  root-only-executable, which the user-tier player could never run). */
export type PatchApi = {
  readonly write: (
    path: AbsPath,
    content: string,
    options?: { readonly isNew?: boolean; readonly permissions?: FilePermissions },
  ) => Promise<PatchResult>;
  readonly remove: (path: AbsPath) => Promise<PatchResult>;
  readonly mkdir: (path: AbsPath) => Promise<PatchResult>;
};

export type PatchResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error: 'no_session' | 'permission_denied' | 'network_error';
    };

export type NetworkView = {
  readonly currentMachine: () => MachineId;
  readonly findMachineByAddress: (addr: NetworkAddress) => MachineId | null;
  readonly resolveDns: (hostname: string) => NetworkAddress | null;
  /** The current machine's NICs, in stable order (lo, eth0, wlan0). Read by
   *  `ifconfig`; mutated (later in the arc) via `env.setInterface`. */
  readonly interfaces: () => readonly NetworkInterface[];
  /** True when any non-loopback interface holds an IPv4 address. The arc's
   *  milestone predicate — `apt`/`nmap` (downstream) gate on it. */
  readonly isOnline: () => boolean;
  /** The WiFi access points in range — seeded once per identity in `ui/state`,
   *  exposed read-only. `airdump` lists them (no password column); `aircrack`
   *  is the only command that reveals a crackable AP's password. */
  readonly wifiNetworks: () => readonly WifiNetwork[];
};

export type OutputSink = {
  readonly text: (content: string) => void;
  readonly error: (content: string) => void;
  readonly dim: (content: string) => void;
};

/** Cross-player primitives — signed-envelope endpoints. Each method returns
 *  its own discriminated error type (per decisions.md D5). */
export type RemoteApi = {
  readonly listPatches: (machineIds: readonly MachineId[]) => Promise<RemoteListPatchesResult>;
  // More methods added as commands need them. The spike doesn't exercise this.
};

export type RemoteListPatchesResult =
  | { readonly ok: true; readonly patches: readonly unknown[] }
  | { readonly ok: false; readonly error: 'network_error' | 'unauthorized' };

export type LogApi = {
  readonly appendAuthLog: (target: MachineId, line: string) => Promise<void>;
  readonly appendAccessLog: (target: MachineId, line: string) => Promise<void>;
};

/** Join a home network by ESSID, returning the LAN address the player was
 *  issued. Local-deterministic today (seeded from identity), the documented
 *  future server boundary (`/api/join-home-network`) — `Promise`-shaped so the
 *  swap is the only change. `nmcli connect` awaits this, then assigns `wlan0`. */
export type HomeNetworkApi = {
  readonly join: (essid: string) => Promise<HomeNetworkAssignment>;
};

// ---- The boundary ----

export type CommandEnv = {
  readonly identity: Identity;
  readonly session: Session;
  readonly hopChain: HopChain;

  readonly gameTime: () => GameTime;
  readonly now: () => EpochMs;

  readonly fs: FsView;
  readonly network: NetworkView;
  readonly output: OutputSink;
  readonly patches: PatchApi;
  readonly remote: RemoteApi;
  readonly log: LogApi;
  readonly homeNetwork: HomeNetworkApi;

  /** Mutate the shell's cwd. UI layer owns the underlying signal; commands
   *  call this when they need to move (`cd`). FsView's `cwd()` reflects
   *  the new value on the next command's env. */
  readonly setCwd: (path: AbsPath) => void;

  /** Replace one interface in the current machine's connectivity state
   *  (read-modify-write of a single Map entry, mirrors `setCwd`). The UI owns
   *  the signal; commands call this to mutate connectivity (airmon flips
   *  `monitorMode`, nmcli sets `association`/`ipv4`). Policy lives in the
   *  command — this seam is generic. `NetworkView`'s reads reflect the new
   *  value on the next command's env. */
  readonly setInterface: (name: string, iface: NetworkInterface) => void;

  /** Request a single line of interactive input from the UI — the general
   *  prompt primitive every credential command reuses (`su` now; ssh/scp/ftp/
   *  mysql/redis later). `masked` hides the input (passwords). Promise-shaped so
   *  a command awaits it inline and composes prompts sequentially (ftp's
   *  username then password). Rejects if the run is aborted (Ctrl-C). */
  readonly prompt: (opts: { readonly message: string; readonly masked: boolean }) => Promise<string>;

  /** Elevate/switch the active session by pushing a new one onto the hop chain
   *  (sibling to `setCwd`/`setInterface`). The UI owns the session stack and
   *  reflects the new active session (prompt, tier) on the next command's env.
   *  `su` pushes a root session; ssh/nc push remote sessions later. */
  readonly pushSession: (session: Session) => void;

  /** Drop the active session, returning to the one beneath it on the hop chain
   *  (the inverse of `pushSession`). The UI restores the previous tier/prompt
   *  AND working directory. `exit` calls this only when `hopChain` is non-empty
   *  (at the base login session there is nothing to return to). Later reused by
   *  every "leave this hop" transition (ssh/nc session exits). */
  readonly popSession: () => void;

  /** Piped input from a previous command in the pipeline. */
  readonly stdin?: AsyncIterable<string>;

  /** Abort-aware delay for pacing streamed output (airdump's scan, aircrack's
   *  crack). Rejects when `signal` fires so Ctrl-C stops a stream mid-flight.
   *  The UI injects a real setTimeout-backed sleep; tests inject an instant one
   *  so streamed commands assert without real waits. */
  readonly sleep: (ms: number) => Promise<void>;

  readonly signal: AbortSignal;
};

// ---- The command itself ----

/** One positional or flag argument a command accepts, for the manual's
 *  ARGUMENTS section. `required` defaults to optional when omitted.
 *
 *  `values` is the discrete set this argument accepts (e.g. apt's `operation`
 *  is `install | list`). Tab-completion reads it for a fixed-value FIRST
 *  positional (`apt <TAB>` → install/list) via `arguments[0].values`; declare
 *  the positionals in order so `arguments[0]` is the command's first one. */
export type CommandArgument = {
  readonly name: string;
  readonly description: string;
  readonly required?: boolean;
  readonly values?: readonly string[];
};

/** A usage example: the command line plus what it does. */
export type CommandExample = {
  readonly command: string;
  readonly description: string;
};

export type ManualPage = {
  readonly synopsis: string;
  readonly description: string;
  readonly arguments?: readonly CommandArgument[];
  readonly examples?: readonly CommandExample[];
};

export type AvailabilityRule =
  | { readonly kind: 'localhost-only' }
  | { readonly kind: 'any-machine' }
  | { readonly kind: 'installed-package'; readonly packageName: string };

/** The sections `help` groups commands into, in display order. Ported verbatim
 *  from legacy (`src/commands/help.ts`). Declared as a runtime tuple so it is a
 *  single source of truth for both the `CommandCategory` type and `help`'s
 *  ordering, and so the registry invariant test can validate against it. */
export const COMMAND_CATEGORIES = ['general', 'filesystem', 'mission', 'network', 'wifi'] as const;

export type CommandCategory = (typeof COMMAND_CATEGORIES)[number];

export type Command = {
  readonly name: string;
  readonly description: string;
  /** Which `help` section this command appears under. */
  readonly category: CommandCategory;
  readonly manual?: ManualPage;
  readonly tier: UserType;
  readonly availability: AvailabilityRule;
  /** Declared flag spec consumed by `bindFlags` before `execute` is called.
   *  Omit for commands that take only positional arguments. */
  readonly flags?: FlagSpec;
  /** Opt-in to UNIX-style short-flag stacking (`ls -la` ≡ `ls -l -a`).
   *  Disabled by default so commands with multi-letter short flags
   *  (`nmap -sV`) keep them unambiguous. Stack members must all be
   *  `'boolean'`-typed. Literal-match wins over expansion. */
  readonly stacking?: boolean;
  readonly execute: (
    env: CommandEnv,
    args: readonly string[],
    flags: ReadonlyMap<string, string | true>,
  ) => Promise<CommandResult>;
};
