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

import type { AbsPath, EpochMs, MachineId, NetworkAddress, PlayerKeyHex, UserType } from '../types';
import type { Directory, FileNode, FilePermissions } from '../filesystem/types';
import type { WalkResult } from '../filesystem/walker';
import type { NetworkInterface } from '../network/interfaces';
import type { HomeNetworkAssignment } from '../network/homeNetwork';
import type { OccupantProjection } from '../network/resolveOccupants';
import type { WifiNetwork } from '../network/wifi';
import type { OpenPort } from '../services/pidfile';
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
  // The browser opens on a page that already came back: the command does the
  // fetching, so a refused connection is reported in the terminal rather than on a
  // screen that has nothing to show.
  | { readonly kind: 'lynx'; readonly url: string; readonly content: string }
  | { readonly kind: 'nc'; readonly target: { readonly ip: NetworkAddress; readonly port: number } }
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
    options?: {
      readonly isNew?: boolean;
      readonly permissions?: FilePermissions;
      /** The content this write was composed against, for a caller that was SHOWN
       *  the file first (an editor). The write is then refused if the machine no
       *  longer holds it, so a stale buffer cannot silently delete another
       *  occupant's edits. Callers with nothing to overwrite — a `>` redirect
       *  truncates by definition, `touch` and `apt` create — omit it and write
       *  unconditionally. */
      readonly baseContent?: string;
    },
  ) => Promise<PatchResult>;
  readonly remove: (path: AbsPath) => Promise<PatchResult>;
  readonly mkdir: (path: AbsPath) => Promise<PatchResult>;
};

export type PatchResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error:
        | 'no_session'
        | 'permission_denied'
        | 'network_error'
        | 'modified_since_open';
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
  /** The WiFi access points in range — the latest scan roll, held in `ui/state`.
   *  `airdump` refreshes it via `rescanWifi`; `aircrack`/`nmcli` then read it to
   *  resolve the AP the player just saw (no password column for airdump — only
   *  `aircrack` reveals a crackable AP's password). */
  readonly wifiNetworks: () => readonly WifiNetwork[];
  /** Re-roll the scan (a fresh draw each call, "relocating"), injecting the given
   *  currently-occupied ESSIDs as discoverable crackable APs. Updates the in-range
   *  list `wifiNetworks` returns AND returns the fresh roll for the caller to
   *  render. Backs `airdump`. */
  readonly rescanWifi: (occupiedEssids: readonly string[]) => readonly WifiNetwork[];
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
  /** Fetch one file over HTTP from a machine behind ANOTHER player's public IP —
   *  the credential-free door, so there is no session to carry. Load-bearing: the
   *  target's journal lives server-side, so its page cannot be computed locally. */
  readonly fetchPublic: (params: PublicFetchParams) => Promise<PublicFetchResult>;
  readonly sweepPublic: (params: PublicSweepParams) => Promise<PublicSweepResult>;
  // More methods added as commands need them. The spike doesn't exercise this.
};

export type RemoteListPatchesResult =
  | { readonly ok: true; readonly patches: readonly unknown[] }
  | { readonly ok: false; readonly error: 'network_error' | 'unauthorized' };

/** What `curl` hands the cross-network fetch. `path` is the URL path AS WRITTEN, not a
 *  file path: which file (if any) it names under the target's document root is the
 *  server's decision, so a client can never point at a file on another player's box. */
export type PublicFetchParams = {
  readonly target: string;
  readonly port: number;
  readonly path: string;
};

/** `host_unreachable` is a connect-level refusal with every cause collapsed (no such
 *  address, dark, bricked, unforwarded, nothing serving the web) — the server withholds
 *  which gate stopped it. `not_found` is the reached server's 404. `network_error` is
 *  OUR side failing to complete the round-trip, which is a different sentence to the
 *  player: the target never answered because we never asked. */
export type PublicFetchResult =
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly error: 'host_unreachable' | 'not_found' | 'network_error' };

/** What a path sweep hands the cross-network seam. It names no words: the server
 *  reads the path list off `callerMachineId`'s journal, the way a credential sweep
 *  reads the password list, so a request cannot ask with words the player never
 *  grew. The machine is the one they are STANDING on — a box taken elsewhere carries
 *  its own list. */
export type PublicSweepParams = {
  readonly target: string;
  readonly port: number;
  readonly callerMachineId: MachineId;
};

/** One word's outcome, as the far side resolved it. `path` is what was FOUND — a
 *  word naming a directory that holds an index comes back as the trailing-slash form
 *  a real server redirects to — so the sweep prints the address a player can go on
 *  to fetch. Size without content: finding a page and reading it are two acts, and
 *  the second leaves its own line in the target's log. */
export type PublicSweepOutcome = {
  readonly path: string;
  readonly status: number;
  readonly size: number;
};

/** `dirlistFound` is false when the machine the caller stands on holds no path list.
 *  That is a real state rather than an error — an ordinary file, absent — and it is
 *  reported instead of an empty run, which would read as a server with nothing on
 *  it. Errors mirror a single fetch: a refusal with every cause collapsed, or our
 *  own side failing to complete the round-trip. */
export type PublicSweepResult =
  | {
      readonly ok: true;
      readonly dirlistFound: boolean;
      readonly results: readonly PublicSweepOutcome[];
    }
  | { readonly ok: false; readonly error: 'host_unreachable' | 'network_error' };

/** The su user-switch event a command hands to `log.appendAuthLog`. Carries no
 *  timestamp: the SERVER stamps the time (UTC) when it records the line, so a
 *  crafted client request can't dictate game time. `machineId` selects the row;
 *  `hostname` is the display name rendered into the syslog line. */
export type AuthLogEvent = {
  readonly machineId: MachineId;
  readonly targetUser: string;
  readonly fromUser: string;
  readonly outcome: 'success' | 'failure';
  readonly hostname: string;
};

/** The own-LAN request (or run of them) handed to `log.appendAccessLog` so the box
 *  that served it records what it was asked for. Carries no machine id, no timestamp,
 *  no status and no size: the SERVER resolves which box answered — the caller's own
 *  workstation or a generated sibling — and reads the pages itself, so a crafted
 *  request can never author a line claiming something was served that never was.
 *
 *  `sourceIp` IS the client's, unlike the cross-player path where the server derives
 *  it. On this path the row is one only the caller can ever read (a generated host's
 *  log is per-viewer) or one they already control at root (their own box), so there is
 *  nothing a forged address could buy. */
export type AccessLogFetch = {
  readonly essid: string;
  /** The LAN address fetched — the server resolves which machine holds it. */
  readonly target: string;
  readonly port: number;
  /** The url paths AS WRITTEN, in the order asked; the server confines each to the
   *  document root itself. `curl` names one, a path sweep names all of them — and a
   *  sweep is one append rather than one round-trip per word, because the run of
   *  misses around a hit is what a defender reads and forty signed requests to write
   *  it would be a different kind of expensive. */
  readonly paths: readonly string[];
  readonly sourceIp: string;
};

export type LogApi = {
  readonly appendAuthLog: (event: AuthLogEvent) => Promise<void>;
  readonly appendAccessLog: (fetched: AccessLogFetch) => Promise<void>;
};

/** Join a home network by ESSID, returning the LAN address the player was ISSUED —
 *  a server-allocated lease, not a local derivation, so two occupants of one AP can
 *  never hold the same address. `null` means no address could be issued (a first
 *  join to an unknown network with the server unreachable): `nmcli connect` reports
 *  the failure and leaves the player disconnected rather than assigning `wlan0` an
 *  address nobody granted. A reconnect to a network already leased succeeds offline
 *  from the client's remembered copy. */
export type HomeNetworkApi = {
  readonly join: (essid: string) => Promise<HomeNetworkAssignment | null>;
  /** Leave a home network (backs `nmcli disconnect`): remove the player's occupancy
   *  row so they vanish from the LAN (Story 7). Fire-and-forget — disconnect is a
   *  local state change that must never block on or fail from this cleanup. */
  readonly leave: (essid: string) => void;
};

/** What the `ssh` command hands to `env.ssh.authenticate` to validate a remote
 *  login. The server regenerates the target's FS from these (the verified pubkey
 *  is added server-side) and validates the password against its `/etc/passwd`. */
export type RemoteAuthParams = {
  /** The client-minted id for the session this login will create. */
  readonly sessionId: string;
  readonly essid: string;
  readonly targetIp: string;
  readonly username: string;
  readonly password: string;
  /** The session beneath this hop (the box you ssh FROM), or null at the base. */
  readonly parentSessionId: string | null;
  /** The IP the connection originates from (the player's wlan0 IP), or null. */
  readonly sourceIp: string | null;
};

/** The outcome of a server-side ssh authentication. On success the userType is
 *  SERVER-derived from the remote `/etc/passwd` (never a client claim). 401-class
 *  `invalid_credentials` covers both bad password and unknown user (no
 *  enumeration); `host_unreachable` is a target that is not a real host. */
export type RemoteAuthResult =
  | { readonly ok: true; readonly userType: UserType }
  | {
      readonly ok: false;
      readonly error: 'invalid_credentials' | 'host_unreachable' | 'network_error';
    };

/** What `ssh` hands to `env.ssh.authenticatePublic` to log into ANOTHER player's
 *  workstation by its PUBLIC IP (Story 2). The server resolves the public IP, rebuilds
 *  the owner's box, and validates against its real `/etc/passwd`. Unlike the LAN
 *  path there is no `essid` — the target is resolved server-side from the public IP. */
export type PublicAuthParams = {
  readonly sessionId: string;
  /** The target PUBLIC IP (resolved server-side to its AP). */
  readonly target: string;
  readonly username: string;
  readonly password: string;
  /** The destination port (default 22). The server routes by it — the router's own
   *  port lands on the router; a NAT-forwarded port lands on the internal host. */
  readonly port: number;
  readonly parentSessionId: string | null;
  readonly sourceIp: string | null;
};

/** The outcome of a cross-player ssh authentication. On success `machineId` is the
 *  OWNER's REAL workstation id (the session target; its name drives the prompt
 *  hostname) and `userType` is server-derived. Errors mirror `RemoteAuthResult`. */
export type PublicAuthResult =
  | { readonly ok: true; readonly userType: UserType; readonly machineId: string }
  | {
      readonly ok: false;
      readonly error: 'invalid_credentials' | 'host_unreachable' | 'network_error';
    };

/** What `ssh` hands to `env.ssh.authenticateSameLan` to log into a FELLOW OCCUPANT's
 *  workstation by its LAN IP over shared WiFi (Story 7). Unlike the public path the
 *  target is on the same LAN — no router/NAT — so the server resolves it through the
 *  ESSID occupancy (`essid` + `targetIp`), not a public IP. Like the public path it
 *  carries a `port` and lands on the OWNER's real workstation id (hence `PublicAuthResult`). */
export type SameLanAuthParams = {
  readonly sessionId: string;
  readonly essid: string;
  readonly targetIp: string;
  readonly username: string;
  readonly password: string;
  /** The destination port (default 22). The server refuses the login unless the
   *  workstation is serving sshd on it. */
  readonly port: number;
  readonly parentSessionId: string | null;
  readonly sourceIp: string | null;
};

/** What `ssh` hands to `env.ssh.authenticateInnerGateway` to log into a hidden
 *  Layer-2 machine THROUGH a NAT forward on the player's OWN inner gateway (multi-layer
 *  depth). Unlike the public/same-LAN paths the target is the player's own gateway: the
 *  server regenerates it from the verified pubkey + `essid`, routes the forwarded `port`
 *  through its `machineServing`, and lands the session on the DEEP HOST's id (hence
 *  `PublicAuthResult`). The deep layer needs no cross-player lookup and no occupancy read —
 *  it regenerates from the ESSID and each gateway's journal. That is not the same as being
 *  private: the chain is ESSID-seeded, so every occupant reaches the same deep boxes. */
export type InnerGatewayAuthParams = {
  readonly sessionId: string;
  readonly essid: string;
  /** The inner gateway's LAN IP — the server regenerates the gateway from the verified
   *  pubkey + essid and routes the forwarded port onto the deep host behind it. */
  readonly target: string;
  readonly username: string;
  readonly password: string;
  /** The forwarded public port on the gateway (e.g. 2222) — the server routes it
   *  through the gateway's NAT to the deep host's internal service. */
  readonly port: number;
  readonly parentSessionId: string | null;
  readonly sourceIp: string | null;
};

/** The remote-login seam — backed by the signed `authCreateSession` (own-LAN),
 *  `authCreateSessionPublic` (cross-player public IP), `authCreateSessionSameLan`
 *  (same-WiFi fellow occupant), and `authCreateSessionInnerGateway` (own deep layer
 *  through a NAT forward) endpoints. The UI wires these to the `sessionsApi` adapters;
 *  `core/` stays adapter-free. `ssh` authenticates through one of them before pushing
 *  a session. */
/** The ftp door, client side. `authenticate` is the same server endpoint `ssh` uses
 *  — one `/etc/passwd`, one tier — asked for an `ftp`-kind row instead of a hop.
 *  `enter`/`leave` are the UI-state half: the session runs ALONGSIDE the shell the
 *  player is standing in rather than on top of it, so it is not `pushSession`'s
 *  business and the hop chain is untouched throughout. */
export type FtpApi = {
  readonly authenticate: (params: RemoteAuthParams) => Promise<RemoteAuthResult>;
  /** Hold this session and put the terminal at the `ftp>` prompt. */
  readonly enter: (session: Session) => void;
  /** Drop it and hand the terminal back to the shell that never moved. */
  readonly leave: () => void;
  /** The REMOTE machine's tree, at the tier the credential bought — an ADDITIVE
   *  second binding, sitting beside `env.fs` rather than replacing it, because the
   *  ftp session runs alongside the shell instead of on top of it. Reads an empty
   *  tree when no session is held: the `ftp>` commands are the only callers and
   *  they cannot run without one, so nothing is hidden by the emptiness — whereas
   *  falling back to the origin would answer a question about their box with a
   *  listing of the player's own. */
  readonly fs: FsView;
  /** Move the REMOTE cwd (backs `cd`). Sibling of `env.setCwd`, which moves the
   *  origin's — the two directories are independent, so `cd` and `lcd` can never
   *  drag each other. */
  readonly setCwd: (path: AbsPath) => void;
};

export type SshApi = {
  readonly authenticate: (params: RemoteAuthParams) => Promise<RemoteAuthResult>;
  readonly authenticatePublic: (params: PublicAuthParams) => Promise<PublicAuthResult>;
  /** Same-LAN login to a fellow occupant — lands on the owner's real workstation id,
   *  so it shares `PublicAuthResult` (ok + userType + machineId). */
  readonly authenticateSameLan: (params: SameLanAuthParams) => Promise<PublicAuthResult>;
  /** Login to a deep Layer-2 host through a NAT forward on the player's own inner
   *  gateway — lands on the deep host's id, so it shares `PublicAuthResult`. */
  readonly authenticateInnerGateway: (params: InnerGatewayAuthParams) => Promise<PublicAuthResult>;
};

/** What `su` hands to `env.su.elevate` to escalate a session it ALREADY holds on a
 *  registered FOREIGN workstation (Story 4): the server resolves the box by its
 *  `machineId`, rebuilds the owner's tree, validates the typed password against its
 *  real `/etc/passwd`, and inserts a root-tier `kind:'su'` session — so B's later
 *  writes authorize at root (L2 reads the active session row's tier). Unlike ssh
 *  there's no host to resolve: B is already on the box. */
export type SuElevateParams = {
  readonly sessionId: string;
  /** The machine B is currently on (the foreign workstation's real id). */
  readonly machineId: string;
  readonly username: string;
  readonly password: string;
  /** B's current user on the box (e.g. `guest`) — the `by <from>` in the target's
   *  su auth.log trace (Story 6.3). Not an identity claim (the verified pubkey is the
   *  actor); it only names which local account ran `su`. */
  readonly fromUser: string;
  readonly parentSessionId: string | null;
  readonly sourceIp: string | null;
};

/** The cross-player `su`-elevation seam — backed by the signed `suElevate` endpoint.
 *  On success the userType is SERVER-derived from the foreign box's `/etc/passwd`
 *  (never a client claim); errors mirror `RemoteAuthResult`. The UI wires it to the
 *  `authElevateServerSession` adapter; `core/` stays adapter-free. */
export type SuApi = {
  readonly elevate: (params: SuElevateParams) => Promise<RemoteAuthResult>;
};

/** What `hydra` hands the crack action. `callerMachineId` names the box whose
 *  wordlist is consulted — the server verifies it belongs to the caller rather
 *  than trusting it, so it is a lookup key, not a privilege claim. `username`
 *  absent means sweep every account the target has. */
export type HydraCrackParams = {
  readonly essid: string;
  readonly target: string;
  readonly service: string;
  readonly username: string | undefined;
  readonly callerMachineId: string;
  /** The address the sweep originates from (the player's wlan0 LAN IP), or null.
   *  The target's auth.log records it, exactly as it records an `ssh` login's — a
   *  sweep and a login from one machine must not read as two different callers. */
  readonly sourceIp: string | null;
};

export type HydraCrackResult =
  | {
      readonly ok: true;
      /** The port the service was actually found listening on. */
      readonly port: number;
      readonly cracked: readonly { readonly username: string; readonly password: string }[];
      /** False when the caller has no wordlist file — distinct from a wordlist
       *  that simply matched nothing, which is a hardened target rather than a
       *  broken setup. */
      readonly wordlistFound: boolean;
    }
  | { readonly ok: false; readonly error: string };

/** What `hydra` hands the CROSS-PLAYER crack action. No `sourceIp`: the address a
 *  foreign target records is derived server-side from the verified key, because a
 *  log line on somebody else's box is evidence and a client could otherwise frame
 *  another network. `target` is a public IP, which names an access point — the
 *  default port reaches its gateway rather than any player's workstation. */
export type HydraCrackPublicParams = {
  readonly essid: string;
  readonly target: string;
  readonly service: string;
  /** The destination port behind the public IP — an access point's forward table is
   *  addressed by port, so this is what names a box rather than the gateway.
   *  `undefined` means the default, which is the gateway's own sshd. */
  readonly port: number | undefined;
  readonly username: string | undefined;
  readonly callerMachineId: string;
};

/** What `hydra` hands the DEEP crack action: a NAT forward on one of the player's own
 *  inner gateways, which is the only way to address a box on the layer behind it. No
 *  `sourceIp` — a deep box is shown the fronting gateway's address by NAT whoever is
 *  behind it, so the server derives it from the route rather than from this request. */
export type HydraCrackInnerGatewayParams = {
  readonly essid: string;
  readonly target: string;
  readonly service: string;
  /** The forwarded port on the gateway — the address of a box behind it. Required:
   *  without a port there is no forward, and the gateway itself is an own-LAN target. */
  readonly port: number;
  readonly username: string | undefined;
  readonly callerMachineId: string;
};

/** The credential-cracking seam, backed by the signed `hydraCrack` endpoints. What
 *  is crackable is decided server-side against the same `/etc/passwd` `ssh` reads,
 *  so the two tools can never disagree about a credential. The split mirrors
 *  `SshApi`'s: reachability decides the action, and each one resolves its target
 *  the same way its `ssh` counterpart does. */
export type HydraApi = {
  readonly crack: (params: HydraCrackParams) => Promise<HydraCrackResult>;
  readonly crackPublic: (params: HydraCrackPublicParams) => Promise<HydraCrackResult>;
  readonly crackInnerGateway: (
    params: HydraCrackInnerGatewayParams,
  ) => Promise<HydraCrackResult>;
};

/** What `nmap` hands to the scan action so the server can record the scan on each
 *  host it touched. The server regenerates the LAN + hosts from the verified
 *  pubkey + essid and writes `/var/log/kern.log` itself — the client never names a
 *  path or content. */
export type ScanRecordParams = {
  readonly essid: string;
  /** The raw nmap target — a single IP (`x.y.z.w`) or a range (`x.y.z.A-B`). */
  readonly target: string;
  /** The IP the scan originates from (the player's wlan0 LAN IP), or null. */
  readonly sourceIp: string | null;
};

/** What `nmap` hands the DEEP scan action so the server can record a pivot scan on
 *  each touched deep host. The server re-derives the vantage gateway from the
 *  verified pubkey + `vantageMachineId`, regenerates its deep layer, and writes
 *  `/var/log/kern.log` itself — the client never names a path, source IP, or
 *  content (the source is the gateway's downstream `.1`, server-derived). */
export type DeepScanRecordParams = {
  readonly essid: string;
  /** The raw nmap target — a single IP (`x.y.z.w`) or a range (`x.y.z.A-B`). */
  readonly target: string;
  /** The machine_id of the gateway the active shell stands on (the pivot vantage). */
  readonly vantageMachineId: string;
};

/** The server-resolved result of scanning a public IP (Story 1). `found` is host
 *  up/down; `ports` are the resolved machine's REAL open ports, read server-side
 *  from the owner's `/var/run/*.pid` record (empty when the host is down or runs
 *  no services). */
export type PublicScanResolution = {
  readonly found: boolean;
  readonly ports: readonly OpenPort[];
};

/** The scan seam. `record` is the fire-and-forget own-LAN scan logger (signed
 *  `nmapScan` endpoint). `resolvePublic` is the cross-player resolution of a
 *  public-IP scan against ANOTHER identity's registered network (signed
 *  `resolvePublicScan` endpoint) — unlike `record` it is load-bearing: its result
 *  drives the scan output. The UI wires both to adapters; `core/` stays
 *  adapter-free. */
export type ScanApi = {
  readonly record: (params: ScanRecordParams) => Promise<void>;
  /** Fire-and-forget logger for a deep PIVOT scan (signed `nmapScanDeep` endpoint):
   *  the deep hosts resolve CLIENT-side (deterministic, no round-trip), and this
   *  records the scan as a `/var/log/kern.log` line on each touched deep host —
   *  readable once the player breaks into it. Best-effort like `record`: a logging
   *  failure never surfaces to the scan. */
  readonly recordDeep: (params: DeepScanRecordParams) => Promise<void>;
  readonly resolvePublic: (target: string) => Promise<PublicScanResolution>;
  /** Resolve the player's OWN-LAN `nmap` of an inner gateway server-side (signed
   *  `resolveInnerGatewayScan` endpoint): its own sshd PLUS any LIVE NAT forward to
   *  the deep layer behind it, read from the gateway's journal at the upstream
   *  (`external`) vantage — the forward lives server-side, so it can't be computed
   *  from the client's static world. Load-bearing like `resolvePublic`. */
  readonly resolveInnerGateway: (
    essid: string,
    target: string,
  ) => Promise<PublicScanResolution>;
  /** Fetch the current ESSID's OTHER occupants for a same-LAN scan (signed
   *  `resolveOccupants` endpoint). `nmap` merges the result over its generated LAN so
   *  a fellow player shows up as a real host. Additive: degrades to an empty list
   *  (server down, or the viewer isn't an occupant) rather than failing the scan. */
  readonly resolveOccupants: (essid: string) => Promise<readonly OccupantProjection[]>;
  /** Fetch the ESSID NAMES anyone currently occupies (signed `resolveOccupiedEssids`
   *  endpoint) — global and name-only, so `airdump` can inject live networks into the
   *  scan for organic discovery. Additive: degrades to an empty list (server down)
   *  rather than failing the scan. */
  readonly resolveOccupiedEssids: () => Promise<readonly string[]>;
};

// ---- The boundary ----

export type CommandEnv = {
  readonly identity: Identity;
  readonly session: Session;
  readonly hopChain: HopChain;

  /** The current machine's short hostname (the `workstation` in the prompt),
   *  sourced from the player's `GameConfig.machineName`. Read by commands that
   *  render machine-identifying output — `su`'s `/var/log/auth.log` syslog line
   *  now; `uname`/other loggers (ssh/ftp) later. */
  readonly hostname: string;

  /** The local host wall clock (epoch-ms) — for ephemeral, non-authoritative
   *  values like session ids. This is NOT game time: the authoritative clock is
   *  server-side (it stamps `/var/log/auth.log`, and later CVE eligibility), so
   *  commands never read a client-computed game time. */
  readonly now: () => EpochMs;

  readonly fs: FsView;
  readonly network: NetworkView;
  readonly output: OutputSink;
  readonly patches: PatchApi;
  readonly remote: RemoteApi;
  readonly log: LogApi;
  readonly homeNetwork: HomeNetworkApi;
  readonly ssh: SshApi;
  readonly ftp: FtpApi;
  readonly su: SuApi;
  readonly scan: ScanApi;
  readonly hydra: HydraApi;

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
  readonly prompt: (opts: {
    readonly message: string;
    readonly masked: boolean;
  }) => Promise<string>;

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

  /** Wipe the player's game and start fresh — the game-only `reset` command's
   *  seam. The UI owns the actual side effect (clear all client-persisted state,
   *  regenerating the identity, then reload to the intro screen); `core/` only
   *  knows there's a trigger. Fire-once: the reload is deferred a beat so the
   *  command's `Resetting game...` line renders before the page tears down. */
  readonly resetGame: () => void;

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
