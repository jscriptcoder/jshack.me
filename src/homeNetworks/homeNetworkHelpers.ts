import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '../identity/hex.js';
import type { Identity } from '../identity/identity.js';
import type { OccupantSummary } from './types.js';

// =====================================================================
// Workstation identity & cross-player addressing helpers.
// =====================================================================
//
// Single source of truth for the workstation_id model. Every helper
// here operates on the player's identity-derived hostname, the storage
// key it stands in for, or the IP-to-machine-id translation other
// players need to address it.
//
// Conceptual layering:
//   - deriveHostnameSuffix:   playerKey            → 8-hex suffix
//   - computePlayerHostname:  workstationName + identity → full hostname
//                                                          (= workstation_id
//                                                          / machine_id)
//   - isOwnWorkstation:       (machineId, ownHostname)  → boolean
//   - displayPromptHostname:  hostname             → suffix-stripped
//                                                    display string
//                                                    (prompt only)
//   - targetMachineIdFor:     IP + lan context     → canonical machine_id
//                                                    a write should land
//                                                    under

// ---------------------------------------------------------------------
// deriveHostnameSuffix
// ---------------------------------------------------------------------
//
// Identity-derived stable hostname suffix. Same player key always
// produces the same suffix, regardless of which LAN they join — gives
// players a recognizable cross-LAN handle for the trail-following
// gameplay AND serves as the disambiguator that lets the full hostname
// be used as the workstation's machine_id.
//
// 8 hex chars = 32 bits of suffix entropy. With ~65k players sharing
// the same workstation_name we'd hit 50% birthday-collision; way more
// headroom than 4 hex (~256-player threshold). Length matters more now
// because hostname collisions don't just cause UX confusion — they
// would merge two players' workstation_id rows in the patches table.
//
// The terminal prompt strips this suffix back off for display
// (displayPromptHostname) so users see `alice@skylab:~$` not
// `alice@skylab-aabbccdd:~$`. Other surfaces (nmap output,
// /etc/hostname, ssh banner, log lines) keep showing the full
// hostname — that's the network identity players need to address
// each other.

export const deriveHostnameSuffix = (playerKey: string): string => {
  const bytes = new TextEncoder().encode(playerKey);
  return bytesToHex(sha256(bytes)).slice(0, 8);
};

// ---------------------------------------------------------------------
// computePlayerHostname
// ---------------------------------------------------------------------
//
// Compose the player's full hostname from the workstation name they
// picked at intro plus the identity-derived suffix. Stable per
// (player, prefix) — every consumer (prompt, /etc/hostname, sample log
// entries, server-side occupant row, FileSystemContext storage key,
// patches.machine_id) should resolve to the same value when given the
// same workstationName and identity.
//
// Computed once at game start (in App.tsx) and threaded down to
// SessionProvider, BootScreen, and generateLocalhost. The hostname is a
// permanent property of the player's machine — not a function of which
// LAN they're on. Real laptops don't rename themselves on WiFi connect.

export const computePlayerHostname = (workstationName: string, identity: Identity): string =>
  computeWorkstationId(workstationName, identity.publicKeyHex);

// Canonical workstation_id from raw publicKeyHex (no 'ed25519:' prefix
// at the call site — this helper applies it). The CLIENT uses
// computePlayerHostname (above), which delegates here. Server-side
// callers (regenWorkstationRows, smoke scripts that need to predict
// the machine_id stored under) MUST go through this same helper, or
// the suffix will diverge between client (prefixed sha256) and server
// (raw sha256). That divergence was the root cause of cross-player
// authCreateSession returning 401 on a player's own workstation —
// surfaced during PR 2 step 12 smoke and fixed here.
export const computeWorkstationId = (workstationName: string, playerKeyHex: string): string =>
  `${workstationName}-${deriveHostnameSuffix(`ed25519:${playerKeyHex}`)}`;

// ---------------------------------------------------------------------
// isOwnWorkstation
// ---------------------------------------------------------------------
//
// Returns true when the given machineId refers to the player's own
// workstation. The workstation's machine_id IS its hostname (the
// suffixed value computed by computePlayerHostname) — same value used
// for storage (patches.machine_id, sessions.machine_id), the Realtime
// channel name, and for cross-player addressing via the LAN occupant
// row's hostname column. This helper documents intent at call sites
// where a literal `=== hostname` would otherwise read ambiguously.
//
// Replaces the legacy `session.machine === 'localhost'` checks. The
// `'localhost'` literal is no longer a magic sentinel in storage —
// it survives only as a CLI alias for loopback targeting, resolved to
// the workstation_id internally by the command parsers.

export const isOwnWorkstation = (machineId: string, ownHostname: string): boolean =>
  machineId === ownHostname;

// ---------------------------------------------------------------------
// displayPromptHostname
// ---------------------------------------------------------------------
//
// Strips the identity-derived 8-hex suffix off a workstation hostname
// for display in the terminal prompt. Workstation_ids look like
// `skylab-aabbccdd`; the suffix is critical for cross-player
// uniqueness in storage but it's noise in the prompt. The prompt
// renders `alice@skylab:~$` instead.
//
// Only the workstation prompt path uses this. Every other surface
// (nmap, /etc/hostname, ssh banner, log lines) shows the full
// hostname unchanged — that's the network identity players need to
// address each other.

const SUFFIX_PATTERN = /-[0-9a-f]{8}$/;

export const displayPromptHostname = (hostname: string): string =>
  hostname.replace(SUFFIX_PATTERN, '');

// ---------------------------------------------------------------------
// targetMachineIdFor
// ---------------------------------------------------------------------
//
// Translate a target IP into the canonical machine_id for storage
// operations. The caller hands us the IP they're targeting (typed by
// the player into nmap/ssh/scp/etc.) and we return what machine_id any
// resulting patches should be stored under.
//
// For LAN occupants on the player's active home network, the IP is
// `${activeSubnet}${occupant.lan_ip}` and the canonical machine_id is
// the occupant's hostname (which IS the workstation_id under the model
// established when the localhost literal was eliminated). Translating
// makes A's writes to B's workstation land under B's canonical
// workstation_id, where B is subscribed via the patches:<workstation>
// Realtime channel and refetches via listPatchesForMachines on hint.
//
// For everything else — mission machines, world machines, IPs on a
// different subnet than the active LAN, the player's own workstation,
// loopback aliases — we return the IP unchanged. Those machine_ids are
// already canonical (mission machine IPs are unique per instance via
// the IP registry; world machine IPs are unique by design; the player's
// own workstation is handled by the caller via `ownLanIp`/`ownHostname`).
//
// `activeSubnet` is the layer-0 subnet of the currently active LAN
// (e.g., '10.0.0'). It's REQUIRED to disambiguate occupant.lan_ip —
// a host octet like `.42` is meaningless without the subnet, and
// targeting the same `.42` on a different /24 must NOT match an
// occupant on the active LAN.
//
// Self-targeting via own LAN IP: if `targetIp` matches the player's own
// `lan_ip` slot on the active LAN (`ownLanIp` is the FULL IP, e.g.
// `10.0.0.99`), returns `ownHostname`. Loopback targeting (`localhost`,
// `127.0.0.1`) is the caller's responsibility — they should resolve
// the alias to the workstation_id before passing here.

export const targetMachineIdFor = (
  targetIp: string,
  lanOccupants: ReadonlyArray<OccupantSummary>,
  activeSubnet: string | null,
  ownLanIp: string | null,
  ownHostname: string,
): string => {
  if (ownLanIp !== null && targetIp === ownLanIp) return ownHostname;
  if (activeSubnet === null) return targetIp;
  if (!targetIp.startsWith(`${activeSubnet}.`)) return targetIp;
  const occupant = lanOccupants.find((o) => `${activeSubnet}${o.lan_ip}` === targetIp);
  return occupant ? occupant.hostname : targetIp;
};

// ---------------------------------------------------------------------
// occupantAwareReadNode
// ---------------------------------------------------------------------
//
// Read-side symmetric of `targetMachineIdFor`: wrap a NodeReader so a
// caller passing a LAN-occupant IP transparently reads from that
// occupant's canonical workstation_id storage key. Mirrors the `logFs`
// pattern in `useNetworkCommands.ts` that translates writes the same
// way — readers and writers must agree on the storage key, otherwise
// cross-player patches (e.g. sshd pid file written by another player
// on the same LAN) land somewhere reads can't find them.
//
// Generic in the read result so this helper doesn't have to import
// `FileNode` and stays decoupled from filesystem types.
//
// Non-occupant IPs (gateway, mission, world, off-LAN) pass through
// `targetMachineIdFor` unchanged — see its tests for the matrix of
// cases it covers.

export const occupantAwareReadNode = <T>(
  readNode: (machineId: string, path: string, cwd: string) => T,
  lanOccupants: ReadonlyArray<OccupantSummary>,
  activeSubnet: string | null,
  ownLanIp: string | null,
  ownHostname: string,
): ((machineId: string, path: string, cwd: string) => T) => {
  return (machineId, path, cwd) =>
    readNode(
      targetMachineIdFor(machineId, lanOccupants, activeSubnet, ownLanIp, ownHostname),
      path,
      cwd,
    );
};
