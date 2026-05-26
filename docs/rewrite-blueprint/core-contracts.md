# `core/` Interface Contracts — Draft

This is the framework-agnostic API surface for the Solid rewrite. Every type here is plain TypeScript with **zero framework imports**. The UI layer (Solid signals + DOM) binds to these contracts; the server (Vercel functions) imports the same types and the same `walker.ts`.

## Guiding rules (read before reviewing)

1. **No reactive primitives in `core/`.** No signals, no stores, no Solid imports. State changes happen through pure functions that return new values. The UI mirrors core state into signals.
2. **`CommandEnv` is the only boundary.** Commands never reach for globals — every dependency comes through `env`. This is what lets the same command run in the browser, in a Node script, and in a test harness.
3. **Walker is shared, byte-identical.** Server and client import `filesystem/walker.ts` from the same source. No duplication.
4. **No mutable singletons.** Every module exports pure functions or type definitions. State lives in the UI layer (signals) and on the server (DB).
5. **Discriminated unions over inheritance.** Every variant type (`Session`, `EffectKind`, `Patch`) uses `kind: '...'` discriminants — easy to exhaustively switch, easy to serialize.
6. **`readonly` everywhere.** All record fields are `readonly`. All arrays are `readonly T[]`. Mutation lives only in adapters.

## Package layout

```
core/
  index.ts                   barrel — re-exports the public surface
  types.ts                   shared primitives (UserType, MachineId, brand types)

  identity/
    keypair.ts               Ed25519 key generation, sign, verify
    workstation.ts           computeWorkstationId (with the 'ed25519:' prefix invariant)
    wallet.ts                wallet key handling (separate from identity)

  signedRequest/
    envelope.ts              SignedEnvelope shape + signRequest()
    verify.ts                verifySignedRequest() + replay protection contract

  session/
    types.ts                 Session, SessionKind, HopChain
    stack.ts                 push/pop/canReturn (pure)

  filesystem/
    types.ts                 FileNode, Directory, FilePermissions
    walker.ts                canRead, canWrite, walkPath  ← shared client+server
    patch.ts                 Patch, applyPatches, ancestorPaths
    selectiveContent.ts      FS_PROJECTED_CONTENT_PATHS allowlist

  network/
    types.ts                 Machine, Port, Interface, RemoteUser, NetworkConfig
    parsers/                 sshd/vsftpd/redis/mysqld/named/apache2/snmpd state parsers
    nat.ts                   resolveNat, iptables rule resolution
    dns.ts                   zone-file parsing, AXFR semantics
    occupants.ts             home_network_occupants resolution

  cve/
    types.ts                 EffectKind, CveTemplate, ExploitResult
    effects.ts               the 8 effect kinds (discriminated union)
    pools.ts                 hand-authored CVE catalog (Layer-1, day-0)
    timeline.ts              procedural CVE generation (Layer-2, time-gated)
    resolver.ts              findExploitableCve(port, gameTime)
    library.ts               library CVE chain (ldd, --local exploits)
    firmware.ts              router firmware versioning

  shell/
    tokenizer.ts             Token type + tokenize()
    parser.ts                AST (Command, Pipeline, Redirect) + parse()
    executor.ts              run a pipeline against a CommandEnv

  commands/
    types.ts                 Command, CommandResult, CommandEnv  ← THE BOUNDARY
    registry.ts              CommandRegistry type
    <name>.ts                one file per command (~75 files, flat)

  generation/
    prng.ts                  Mulberry32 seeded RNG
    ip.ts                    deterministic IP allocation per LAN
    machine.ts               machine assembly from pools
    network.ts               full network topology generation
    filesystem.ts            base FS per machine type
    homeNetwork.ts           generateHomeNetwork(seed, wifi)
    missionNetwork.ts        generateMissionNetwork(seed)
    user.ts                  GeneratedUser (intermediate type, has passwordHash)

  logging/
    formats.ts               auth.log, vsftpd.log, redis.log, access.log, syslog formatters

  game/
    seed.ts                  generateGameSeed()
    time.ts                  gameTime contract (client-side fallback + server-stamped target)

  apt/
    types.ts                 PackageStatus, UpgradeResult
    resolver.ts              apt list/upgrade/install/remove logic (pure)
```

---

## Cross-cutting types

```ts
// core/types.ts

/** Privilege tier — the unit the walker checks against. */
export type UserType = 'guest' | 'user' | 'root';

/** Canonical machine identifier on the wire. */
export type MachineId = string & { readonly __brand: 'MachineId' };

/** Player Ed25519 public key, hex-encoded (no 0x prefix). */
export type PlayerKeyHex = string & { readonly __brand: 'PlayerKeyHex' };

/** Network address. Either an IPv4 string or a hostname. */
export type NetworkAddress = string & { readonly __brand: 'NetworkAddress' };

/** Absolute filesystem path, normalized (no '..', no trailing slash except '/'). */
export type AbsPath = string & { readonly __brand: 'AbsPath' };

/** Game-day count since the player's startedAt anchor. */
export type GameTime = number & { readonly __brand: 'GameTime' };

/** Milliseconds-since-epoch timestamp. */
export type EpochMs = number & { readonly __brand: 'EpochMs' };

/** Hex-encoded SHA-256 hash. */
export type Sha256Hex = string & { readonly __brand: 'Sha256Hex' };

/** Brand-stripping constructors live in core/types.ts — exported as `asMachineId(s)` etc.
 *  These exist purely for type discipline; runtime cost is zero. */
```

---

## Identity

```ts
// core/identity/keypair.ts

export type Identity = {
  readonly publicKeyHex: PlayerKeyHex;
  readonly privateKeyHex: string;  // never logged, never serialized to disk in plaintext
};

/** Generate a fresh Ed25519 keypair from a CSPRNG. */
export const generateIdentity: () => Identity;

/** Deterministic sign — same (key, msg) always produces the same signature. */
export const sign: (identity: Identity, message: Uint8Array) => string;  // hex

/** Verify a signature against a public key. */
export const verify: (
  publicKeyHex: PlayerKeyHex,
  message: Uint8Array,
  signatureHex: string,
) => boolean;
```

```ts
// core/identity/workstation.ts

/** Load-bearing invariant: the SHA-256 input includes the literal 'ed25519:' prefix.
 *  Bypassing this constant (passing raw playerKeyHex to deriveSuffix) produces a
 *  divergent suffix and silently breaks every cross-player auth/L1/L2 path. */
const ED25519_PREFIX = 'ed25519:' as const;

/** Compute the 8-hex-char workstation suffix from a player's public key. */
export const deriveWorkstationSuffix: (playerKey: PlayerKeyHex) => string;
// internally: sha256(utf8(ED25519_PREFIX + playerKey)).hex().slice(0, 8)

/** Compute the canonical machine_id for a player's own workstation.
 *  This is THE storage key everywhere: patches, sessions, Realtime channel, occupant hostname. */
export const computeWorkstationId: (
  workstationName: string,
  playerKey: PlayerKeyHex,
) => MachineId;
// internally: asMachineId(`${workstationName}-${deriveWorkstationSuffix(playerKey)}`)
```

```ts
// core/identity/wallet.ts

/** Separate keypair, lives in the in-game filesystem, lost on permadeath.
 *  Defends "what I own" — wallet defense is gameplay, identity defense is platform. */
export type WalletKeypair = {
  readonly publicKeyHex: string;
  readonly privateKeyPem: string;  // PEM format because cat-able by the player
};

export const generateWallet: () => WalletKeypair;
```

---

## Signed envelope

```ts
// core/signedRequest/envelope.ts

/** Wire format for every authenticated API call. */
export type SignedEnvelope = {
  readonly publicKey: PlayerKeyHex;
  readonly payload: string;        // canonical JSON string (sign-the-literal-bytes rule)
  readonly signature: string;      // hex
};

/** Internal payload schema — every action has the same outer shape. */
export type SignedPayload<TAction extends string, TData> = {
  readonly action: TAction;
  readonly ts: EpochMs;
  readonly nonce: string;          // 32 hex chars (128 bits)
  readonly data: TData;
};

/** Sign a payload. Library injects ts + nonce; caller-supplied versions are stripped. */
export const signRequest: <TAction extends string, TData>(
  identity: Identity,
  action: TAction,
  data: TData,
) => SignedEnvelope;
```

```ts
// core/signedRequest/verify.ts

/** Server-side verification contract. The actual nonce store is an adapter dependency. */
export type NonceStore = {
  readonly checkAndStore: (nonce: string, ttlSec: number) => Promise<boolean>;
  // returns true if nonce is fresh (stored), false if duplicate
};

export type VerifyResult =
  | { readonly ok: true; readonly publicKey: PlayerKeyHex; readonly payload: SignedPayload<string, unknown> }
  | { readonly ok: false; readonly error: VerifyError };

export type VerifyError =
  | 'envelope_invalid'
  | 'signature_invalid'
  | 'ts_window'
  | 'nonce_invalid'
  | 'replay'
  | 'payload_schema';

export const verifySignedRequest: (
  envelope: SignedEnvelope,
  nonceStore: NonceStore,
  options: { readonly tsWindowMs: number; readonly nonceTtlSec: number },
) => Promise<VerifyResult>;

/** Verification order (must match):
 *   1. Envelope shape (publicKey + payload + signature exist + correct hex shape)
 *   2. Signature verifies against publicKey + payload-as-bytes
 *   3. ts within window (default ±60s)
 *   4. nonce schema (32 hex chars)
 *   5. nonce not yet seen (atomic check-and-store)
 *   6. payload parses as SignedPayload<string, unknown>
 */
```

---

## Session

```ts
// core/session/types.ts

/** A server-authoritative session — represents a player's presence on a machine. */
export type Session = {
  readonly id: string;                    // server-assigned UUID
  readonly playerKey: PlayerKeyHex;
  readonly machineId: MachineId;
  readonly username: string;
  readonly userType: UserType;
  readonly kind: SessionKind;
  readonly createdAt: EpochMs;
};

/** Every session kind, exhaustively. */
export type SessionKind =
  // Interactive (push onto hop stack on the client)
  | 'ssh'                     // login over ssh
  | 'su'                      // local privilege change
  | 'exploit'                 // CVE-granted full shell
  // One-shot effects (created on demand, not on the stack)
  | 'effect_one_shot'         // file_read / dir_list result; tier from CVE
  | 'effect_password_reset'   // root-tier read for /etc/passwd, regardless of CVE tier
  // Backdoor / connection-only
  | 'nc'                      // netcat shell (pidfile-tracked, restricted)
  // Protocol-only (no shell, just authenticated connection)
  | 'ftp'
  | 'mysql'
  | 'redis'
  // Mission stand-in (placeholder session for accepted mission lifecycle)
  | 'mission';

/** Hop chain — linear stack of sessions across machines. UI-side concept. */
export type HopChain = readonly Session[];
```

```ts
// core/session/stack.ts

export const pushSession: (chain: HopChain, session: Session) => HopChain;
export const popSession: (chain: HopChain) => HopChain;  // returns same chain if empty
export const canReturn: (chain: HopChain) => boolean;
export const currentSession: (chain: HopChain) => Session | null;
```

---

## Filesystem & permissions

```ts
// core/filesystem/types.ts

export type FilePermissions = {
  readonly owner: string;
  readonly group: string;
  readonly mode: number;       // octal: 0o755, 0o644, etc.
};

export type FileNode = FileEntry | Directory;

export type FileEntry = {
  readonly kind: 'file';
  readonly content: string;
  readonly perms: FilePermissions;
  readonly metadata?: FileMetadata;
};

export type Directory = {
  readonly kind: 'directory';
  readonly entries: ReadonlyMap<string, FileNode>;
  readonly perms: FilePermissions;
};

export type FileMetadata = {
  readonly mtime?: EpochMs;
  readonly isExecutable?: boolean;
  readonly libraryLinks?: readonly string[];   // for /bin/* — which /lib/* libs they link
};
```

```ts
// core/filesystem/walker.ts
// SHARED CLIENT + SERVER. Single source of truth for permission decisions.

export type WalkResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: WalkDenyReason };

export type WalkDenyReason =
  | 'parent_unreadable'
  | 'target_unreadable'
  | 'target_unwritable'
  | 'not_directory'
  | 'not_found';

export const canRead: (
  userType: UserType,
  target: FilePermissions | null,        // null = leaf-only fallback
  parentChain: readonly FilePermissions[],
) => WalkResult;

export const canWrite: (
  userType: UserType,
  target: FilePermissions | null,
  parentChain: readonly FilePermissions[],
) => WalkResult;

/** Decompose an absolute path into the parent chain.
 *  ancestorPaths('/a/b/c.txt') → ['/', '/a', '/a/b', '/a/b/c.txt'] */
export const ancestorPaths: (path: AbsPath) => readonly AbsPath[];

/** Walk a path through a FileNode tree, returning the leaf + parent chain. */
export const walkPath: (
  root: Directory,
  path: AbsPath,
) => { readonly node: FileNode | null; readonly parents: readonly FilePermissions[] };
```

```ts
// core/filesystem/patch.ts

export type Patch = {
  readonly machineId: MachineId;
  readonly path: AbsPath;
  readonly content: string | null;         // null = file deletion
  readonly perms?: FilePermissions;        // may be omitted on update-only
  readonly isNew?: boolean;
  readonly originatorKey: PlayerKeyHex;    // server-stamped, NOT client-supplied
  readonly ts: EpochMs;
};

/** Apply patches in order on top of a base FS. Last-write-wins per (machineId, path). */
export const applyPatches: (
  base: Directory,
  patches: readonly Patch[],
) => Directory;
```

```ts
// core/filesystem/selectiveContent.ts

/** Server-side projection rule: which paths get content stored in machine_filesystems.
 *  Adding a path is a one-line change + backfill rerun. */
export const FS_PROJECTED_CONTENT_PATHS: readonly AbsPath[] = [
  '/etc/passwd',
  '/etc/vsftpd/virtual_users.conf',
  '/var/run/nc-*.pid',          // glob — implementation expands
  // ... see Section 4.16
];

export const shouldProjectContent: (path: AbsPath) => boolean;
```

---

## Network

```ts
// core/network/types.ts

export type Machine = {
  readonly id: MachineId;
  readonly hostname: string;
  readonly role: MachineRole;
  readonly interfaces: readonly Interface[];
  readonly ports: readonly Port[];
  readonly users: readonly RemoteUser[];      // ← no passwordHash field; that's only in GeneratedUser
  readonly filesystem: Directory;
  readonly natRules?: readonly NatRule[];
  readonly firmware?: FirmwareInfo;
};

export type MachineRole =
  | 'router' | 'gateway' | 'switch' | 'server' | 'database' | 'workstation'
  | 'npc' | 'browser' | 'iot' | 'storage' | 'mail';

export type Interface = {
  readonly name: string;                       // 'eth0', 'wlan0', 'lo'
  readonly ip: NetworkAddress;
  readonly subnet: string;                     // CIDR
};

export type Port = {
  readonly number: number;
  readonly protocol: 'tcp' | 'udp';
  readonly service: string;                    // 'ssh', 'http', 'mysql', ...
  readonly serviceVersion: string;             // 'OpenSSH_8.4p1', 'Apache/2.4.49', ...
  readonly owner: ServiceOwner | null;         // see CVE section — null means msfconsole rejects
};

export type ServiceOwner = {
  readonly user: string;
  readonly userType: UserType;
};

/** A user record as it appears on a remote machine. NO passwordHash — credentials
 *  come from /etc/passwd content via the FS, not from this type. Sabotage via garble
 *  is a real attack vector by design. */
export type RemoteUser = {
  readonly username: string;
  readonly userType: UserType;
  readonly homeDir: AbsPath;
  readonly shell: string;
};
```

```ts
// core/network/nat.ts

export type NatRule = {
  readonly chain: 'PREROUTING' | 'FORWARD' | 'OUTPUT';
  readonly proto: 'tcp' | 'udp';
  readonly publicIp: NetworkAddress;
  readonly publicPort: number;
  readonly destIp: NetworkAddress;
  readonly destPort: number;
};

export type NatResolution = {
  readonly resolvedIp: NetworkAddress;
  readonly resolvedPort: number;
  readonly chain: readonly NatRule[];          // for traceroute-style debugging
};

/** Resolve a public IP:port to a destination machine through the iptables chain. */
export const resolveNat: (
  rules: readonly NatRule[],
  publicIp: NetworkAddress,
  publicPort: number,
) => NatResolution | null;
```

---

## CVE & exploits

```ts
// core/cve/effects.ts

export type EffectKind =
  | { readonly kind: 'shell_full'; readonly tier: UserType }
  | { readonly kind: 'shell_limited' }
  | { readonly kind: 'file_read'; readonly tier: UserType }
  | { readonly kind: 'dir_list'; readonly tier: UserType }
  | { readonly kind: 'file_write'; readonly tier: UserType }
  | { readonly kind: 'password_reset' }       // always root-tier read of /etc/passwd
  | { readonly kind: 'backdoor_port_open'; readonly port: number; readonly tier: UserType }
  | { readonly kind: 'script_exec'; readonly tier: UserType };
```

```ts
// core/cve/types.ts

export type CveTemplate = {
  readonly id: string;                         // 'CVE-2024-9001'
  readonly title: string;
  readonly service: string;                    // 'ssh', 'http', ...
  readonly serviceVersion: string;             // exact match required for resolver
  readonly effect: EffectKind;
  readonly publishedAt: GameTime;              // 0 for hand-authored day-0 CVEs
  readonly source: 'layer1' | 'layer2';
};

export type ExploitResult =
  | { readonly ok: true; readonly cve: CveTemplate; readonly effect: EffectKind }
  | { readonly ok: false; readonly reason: ExploitFailReason };

export type ExploitFailReason =
  | 'no_cve_for_version'
  | 'cve_not_yet_published'
  | 'port_not_open'
  | 'service_not_exploitable';                 // port has no owner stamp
```

```ts
// core/cve/resolver.ts

/** Resolve whether a port is exploitable right now. */
export const findExploitableCve: (
  port: Port,
  gameTime: GameTime,
  pools: { readonly layer1: readonly CveTemplate[]; readonly layer2: readonly CveTemplate[] },
) => ExploitResult;

/** Layer 2 procedural generation — one CVE roughly every 13 hours of game time. */
export const generateLayer2Cves: (
  seed: string,
  uptoGameTime: GameTime,
) => readonly CveTemplate[];
```

```ts
// core/cve/library.ts

/** The 8 shared libraries that back pre-installed commands. */
export const LIBRARY_NAMES = [
  'libpam', 'libcrypt', 'libsystemd', 'libreadline',
  'libssl', 'libz', 'libxml2', 'libpcre',
] as const;
export type LibraryName = (typeof LIBRARY_NAMES)[number];

/** Resolve `msfconsole --local <command>` — find a CVE on a library the command links. */
export const findLocalLibraryExploit: (
  command: string,                              // 'su', 'ls', 'ps', ...
  filesystem: Directory,
  gameTime: GameTime,
) => ExploitResult;

/** Meta-packages — apt upgrade auth-libs == upgrade libpam + libcrypt. */
export const META_PACKAGES: ReadonlyMap<string, readonly LibraryName[]>;
```

---

## Shell

```ts
// core/shell/tokenizer.ts

export type Token =
  | { readonly kind: 'word'; readonly value: string }
  | { readonly kind: 'pipe' }
  | { readonly kind: 'redirect_out' }                    // >
  | { readonly kind: 'redirect_append' }                 // >>
  | { readonly kind: 'string'; readonly value: string }  // quoted, single or double
  | { readonly kind: 'flag'; readonly name: string };    // -v, --verbose

export const tokenize: (input: string) => readonly Token[];
```

```ts
// core/shell/parser.ts

export type ParsedCommand = {
  readonly command: string;
  readonly args: readonly string[];
  readonly flags: ReadonlyMap<string, string | true>;
};

export type Pipeline = {
  readonly commands: readonly ParsedCommand[];           // ≥1
  readonly redirect?: { readonly path: string; readonly append: boolean };
};

export const parse: (tokens: readonly Token[]) => Pipeline;
```

---

## Commands — the boundary contract

This is the most important file in `core/`. **Every command implements this signature, and the `CommandEnv` is the *only* thing the UI has to construct.**

```ts
// core/commands/types.ts

/** A command's lifetime output. Lines can be streamed via AsyncIterable, or returned
 *  all at once via array. Both shapes are equivalent — the UI handles both. */
export type CommandResult =
  | { readonly kind: 'sync'; readonly lines: readonly TerminalLine[]; readonly exitCode: number }
  | { readonly kind: 'async'; readonly lines: AsyncIterable<TerminalLine>; readonly exitCode: () => Promise<number> }
  | { readonly kind: 'mode_change'; readonly mode: ModeChange };

/** A line of terminal output. Discriminated for renderer dispatch. */
export type TerminalLine =
  | { readonly kind: 'text'; readonly content: string }
  | { readonly kind: 'error'; readonly content: string }
  | { readonly kind: 'dim'; readonly content: string }
  | { readonly kind: 'prompt'; readonly content: string };

/** A command can request the terminal enter a special mode (nano, lynx, nc shell, ftp, etc.) */
export type ModeChange =
  | { readonly kind: 'nano'; readonly path: AbsPath; readonly content: string }
  | { readonly kind: 'lynx'; readonly url: string }
  | { readonly kind: 'nc'; readonly target: NcTarget }
  | { readonly kind: 'ftp'; readonly target: FtpTarget }
  | { readonly kind: 'mysql'; readonly target: MysqlTarget }
  | { readonly kind: 'redis'; readonly target: RedisTarget };

/** THE BOUNDARY. Every dependency the command needs comes through here.
 *  This is the only thing the UI layer has to construct. */
export type CommandEnv = {
  // --- Identity & session (read-only snapshots) ---
  readonly identity: Identity;
  readonly session: Session;
  readonly hopChain: HopChain;

  // --- Time ---
  readonly gameTime: () => GameTime;
  readonly now: () => EpochMs;

  // --- Filesystem (current machine view) ---
  readonly fs: FsView;

  // --- Network (current view from session.machineId) ---
  readonly network: NetworkView;

  // --- Output sink (for streaming lines) ---
  readonly output: OutputSink;

  // --- Patch API (mutations route through here) ---
  readonly patches: PatchApi;

  // --- Cross-player primitives (signed envelope endpoints) ---
  readonly remote: RemoteApi;

  // --- Stdin (for piped commands) ---
  readonly stdin?: AsyncIterable<string>;

  // --- Logging API (auth.log / access.log / etc) ---
  readonly log: LogApi;

  // --- Cancellation ---
  readonly signal: AbortSignal;
};

/** The Command itself. */
export type Command = {
  readonly name: string;
  readonly description: string;
  readonly manual?: ManualPage;
  readonly tier: UserType;                     // minimum tier to invoke
  readonly availability: AvailabilityRule;     // 'localhost-only' | 'any-machine' | { installed: 'pkg' }
  readonly execute: (env: CommandEnv, args: readonly string[], flags: ReadonlyMap<string, string | true>) => Promise<CommandResult> | CommandResult;
};

export type AvailabilityRule =
  | { readonly kind: 'localhost-only' }
  | { readonly kind: 'any-machine' }
  | { readonly kind: 'installed-package'; readonly packageName: string };
```

### The sub-APIs on `CommandEnv`

```ts
// core/commands/types.ts (continued)

export type FsView = {
  readonly read: (path: AbsPath) => string | null;
  readonly list: (path: AbsPath) => readonly string[] | null;
  readonly stat: (path: AbsPath) => FileNode | null;
  readonly cwd: () => AbsPath;
  // Writes go through patches (next).
};

export type PatchApi = {
  readonly write: (path: AbsPath, content: string, perms?: FilePermissions) => Promise<PatchResult>;
  readonly remove: (path: AbsPath) => Promise<PatchResult>;
  readonly mkdir: (path: AbsPath, perms?: FilePermissions) => Promise<PatchResult>;
};

export type PatchResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: 'no_session' | 'permission_denied' | 'network_error' };

export type NetworkView = {
  readonly currentMachine: () => MachineId;
  readonly findMachineByAddress: (addr: NetworkAddress) => Machine | null;
  readonly resolveDns: (hostname: string) => NetworkAddress | null;
  readonly reachableFrom: (source: MachineId) => readonly Machine[];
  readonly resolveNatChain: (publicAddr: NetworkAddress, port: number) => NatResolution | null;
  readonly occupantsOf: (machineId: MachineId) => readonly Occupant[];
};

export type RemoteApi = {
  readonly createSession: (req: CreateSessionRequest) => Promise<Session | RemoteError>;
  readonly endSession: (sessionId: string) => Promise<void>;
  readonly exploitRead: (target: MachineId, path: AbsPath) => Promise<string | null | RemoteError>;
  readonly crackCredentials: (req: CrackRequest) => Promise<CrackResult | RemoteError>;
  readonly getBaseFs: (target: MachineId, userType: UserType) => Promise<Directory | null | RemoteError>;
  readonly listPatches: (machineIds: readonly MachineId[]) => Promise<readonly Patch[] | RemoteError>;
};

export type OutputSink = {
  readonly text: (content: string) => void;
  readonly error: (content: string) => void;
  readonly dim: (content: string) => void;
};

export type LogApi = {
  readonly appendAuthLog: (target: MachineId, line: string) => Promise<void>;
  readonly appendAccessLog: (target: MachineId, line: string) => Promise<void>;
  readonly appendFtpLog: (target: MachineId, line: string) => Promise<void>;
  readonly appendRedisLog: (target: MachineId, line: string) => Promise<void>;
  readonly appendSyslog: (target: MachineId, line: string) => Promise<void>;
  // ... etc — formatters live in core/logging/formats.ts
};
```

---

## What a command actually looks like

To prove the contract is real, here's how `cat` would be implemented end-to-end. **Note: zero UI imports, zero Solid, zero React. Plain TypeScript on the `CommandEnv` boundary.**

```ts
// core/commands/cat.ts

import type { Command, CommandEnv, CommandResult, AbsPath } from '../types';
import { resolveAbsPath } from '../../filesystem/path';

export const cat: Command = {
  name: 'cat',
  description: 'Concatenate and print files',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'cat [file...]',
    description: 'Print the contents of each file to stdout.',
    examples: ['cat /etc/passwd', 'cat file1 file2 | grep root'],
  },
  execute: async (env, args, _flags) => {
    if (args.length === 0 && env.stdin) {
      // Piped from another command — just echo stdin
      const lines: TerminalLine[] = [];
      for await (const line of env.stdin) lines.push({ kind: 'text', content: line });
      return { kind: 'sync', lines, exitCode: 0 };
    }

    const lines: TerminalLine[] = [];
    let exitCode = 0;

    for (const arg of args) {
      const path = resolveAbsPath(env.fs.cwd(), arg);
      const content = env.fs.read(path);

      if (content === null) {
        lines.push({ kind: 'error', content: `cat: ${arg}: No such file or directory` });
        exitCode = 1;
        continue;
      }

      for (const line of content.split('\n')) {
        lines.push({ kind: 'text', content: line });
      }
    }

    return { kind: 'sync', lines, exitCode };
  },
};
```

And here's how the UI layer wires it up (Solid + plain DOM):

```ts
// ui/state.ts (Solid signals, framework boundary)

import { createSignal, createStore } from 'solid-js';
import { catCommand } from '../core/commands/cat';
import { buildCommandEnv } from './env';

const [scrollback, setScrollback] = createStore<TerminalLine[]>([]);
const [currentSession, setCurrentSession] = createSignal<Session>(/* ... */);

async function runCommand(name: string, args: string[], flags: Map<string, string | true>) {
  const env = buildCommandEnv({ session: currentSession(), /* ... */ });
  const result = await catCommand.execute(env, args, flags);

  if (result.kind === 'sync') {
    setScrollback(prev => [...prev, ...result.lines]);
  } else if (result.kind === 'async') {
    for await (const line of result.lines) setScrollback(prev => [...prev, line]);
  }
}
```

Notice: `cat` doesn't know Solid exists. The signal subscription is purely in the UI layer.

---

## Invariants the rewrite must preserve

These are non-negotiable. If a draft violates one, it's wrong.

1. **The `'ed25519:'` prefix in `deriveWorkstationSuffix`** — encoded as a private module constant, single function entry point. No way to compute the suffix without the prefix.
2. **`RemoteUser` has no `passwordHash` field.** Credentials are read from `/etc/passwd` content via the FS. The intermediate `GeneratedUser` type (in `generation/`) carries the hash during generation but is stripped before becoming `RemoteUser`.
3. **`Patch.originatorKey` is server-stamped.** The client-side `PatchApi.write()` never accepts it from the caller — the adapter sets it from the verified envelope key.
4. **Walker code is imported by both UI and server** — single `core/filesystem/walker.ts` file. Server's `api/patches.ts` and the UI's L2-equivalent client-side filter use the same imports.
5. **`MachineId` is opaque on the wire.** Code never parses or constructs it ad-hoc except through `computeWorkstationId()` and `asMachineId()`. The `${name}-${suffix}` shape is an internal convention, not a public API.
6. **No mutation outside adapters.** Every core function returns a new value. Mutation lives in `ui/state.ts` (signals) and `adapters/storage/` (IndexedDB writes).
7. **Time is injected.** Commands never call `Date.now()` directly — they call `env.now()`. Same for `gameTime()`. This makes testing deterministic and lets the server stamp the value in multiplayer.
8. **No reactive primitives in `core/`.** Signals never leak in. Effects never leak in. Commands return values; the UI subscribes to changes.
9. **`AbortSignal` for cancellation.** Long-running commands (`nmap`, `aircrack`, `ping`) take `env.signal` and abort cleanly. The UI provides the signal from a Ctrl-C handler.
10. **One file per command.** No mega-modules. Each command in `core/commands/<name>.ts`, flat — no `impl/` nesting.

---

## What lives in the UI layer (NOT in core)

To make the boundary explicit:

- All Solid signals and stores
- All DOM manipulation
- The scrollback buffer (it's a signal, not a core concept)
- The current screen ('intro' | 'boot' | 'terminal' | 'nano' | 'lynx')
- Theme application (CSS variable writes)
- Keyboard event listeners (history nav, tab complete, Ctrl-C wiring)
- The `buildCommandEnv()` factory that wires core to adapters
- All `.tsx` files
- Local UI mode state (input value, cursor position, autocomplete dropdown)

---

## What lives in `adapters/` (NOT in core, NOT in UI)

- IndexedDB read/write for patches, sessions, gameState
- Supabase client setup and the actual fetch calls for `/api/*`
- Supabase Realtime channel subscriptions
- BroadcastChannel cross-tab messaging
- The nonce store implementation (Upstash Redis on server)

The UI imports adapters; adapters import core types but never UI; core imports neither.

---

## Open questions for the rewrite

These need decisions before implementation starts:

1. **Async vs sync command execution.** Should every command be `async` for uniformity, or should sync commands stay sync? Recommendation: sync return type for instant commands (`pwd`, `whoami`); async for anything that touches network or streams output.
2. **Streaming output backpressure.** `nmap` can produce hundreds of lines fast. Should `OutputSink` buffer or apply backpressure? Recommendation: buffer; the UI debounces signal updates anyway.
3. **Error encoding.** `RemoteError` is one big union, but server endpoints return distinct error codes (`no_session`, `permission_denied`, `usertype_mismatch`, etc.). Should errors be typed per-endpoint or unified? Recommendation: per-endpoint discriminated union for type safety.
4. **Server-stamped gameTime.** Should `env.gameTime()` always be async (server round-trip) or use a cached server-stamped value refreshed periodically? Recommendation: cached + refreshed on session-creation responses (server stamps gameTime in every reply).
5. **How big is `pools/`?** The existing repo has ~40 hand-authored CVEs + procedural generation. Should `pools.ts` be one file or split? Recommendation: one file per pool category (`pools/web.ts`, `pools/database.ts`, `pools/firmware.ts`), barrel-exported.
6. **Testing harness.** Building a `CommandEnv` test factory should be trivial. Recommendation: `test/factories/commandEnv.ts` exports a `mockCommandEnv(overrides)` that defaults every field to a sensible mock.

---

## Next steps if you greenlight this

1. Lock down the `CommandEnv` shape (this doc). Bikeshedding here pays off forever.
2. Decide the open questions above.
3. Spike one full command end-to-end (`cat` is a good first one — touches FS, output, env, error paths) in a throwaway repo to validate the boundary holds.
4. Spike one cross-player command (`ssh` is the canonical hard case — touches identity, signed envelope, session creation, hop chain, network resolution, NAT, /etc/passwd auth, logging).
5. Lock the Supabase schema (it's identical to current — §4.4 of the blueprint is the spec).
6. Start fresh repo with `core/` first, `adapters/` second, `ui/` last.
