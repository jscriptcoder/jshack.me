# Plan: Remote access via SSH

**Branch (Slice 1)**: feat/sshd-service
**Status**: Active — Slice 1 specified, Slices 2–3 sketched (graduate to their own detail when reached)
**Type**: New epic. Sits on top of a NEW "running services / pidfile" primitive and absorbs
generator-epic **Story 3** (enter a generated machine + browse its base FS). Ports/auth were
explicitly deferred out of `network-generator-epic.md` (lines 48–52) — this is that later epic.

> The `story-splitting` skill is not installed here; this split follows the `planning` skill's
> vertical-slice rules manually, like `network-generator-epic.md` did. Every slice delivers one
> observable behaviour through the real terminal path and is independently mergeable.

## Goal

Let a player connect to a generated remote machine with `ssh user@host`, authenticating against
that machine's real `/etc/passwd` and landing in its filesystem — built on a pidfile-based
"running services" model where `/var/run/*.pid` is the literal source of truth for open ports.

## The model (the spine every slice rides on)

`/var/run/sshd.pid` — a real file — is **the** source of truth for "is the ssh service up / is
port 22 open". Legacy-faithful format (confirmed against legacy `ps.ts`/`kill.ts`/`sshd.ts`):

```
/var/run/sshd.pid   content:  sshd:port=22        (or sshd:port=2222 for a custom port)
```

**Two producers, one format, many readers:**

```
/var/run/sshd.pid  ◄── `sshd` command writes it   (machines you control: Slice 1)
                   ◄── generator plants it          (NPC hosts: Slice 2)
        │
        └──► read by:  nmap (port state) · ssh (port open?) · future `ps`/`kill`
```

The pidfile **format + parser is shared knowledge (DRY)** — whatever `sshd` writes, the generator
must plant byte-identically, and every reader parses identically. That parser is built once in
Slice 1 and reused everywhere.

### Service catalog — the single tweakable home for all services

A declarative table (v2 port of legacy `INFRA_PID_CONFIGS`) is the one place every service is
described. **Adding a service = one row; tuning a knob = one number.** The `sshd` command, the
generator, and the pidfile parser all read from it, so the format/name stays DRY.

```ts
// core/services/serviceCatalog.ts
export type ServiceSpec = {
  readonly service: string;     // 'ssh'      — nmap SERVICE label
  readonly pidfile: string;     // 'sshd.pid' — /var/run/<pidfile>
  readonly defaultPort: number; // 22
  readonly runUser: string;     // 'root'     — pidfile owner / daemon run-user
  readonly placement: number;   // 0.4        — deterministic ~40% of hosts (added in Slice 2)
};
export const SERVICE_CATALOG = {
  ssh: { service: 'ssh', pidfile: 'sshd.pid', defaultPort: 22, runUser: 'root', placement: 0.4 },
} as const satisfies Record<string, ServiceSpec>;
```

**Discipline (don't gold-plate):** rows arrive when a service ships; **columns arrive when a slice
consumes them**. Slice 1 introduces the catalog with `service/pidfile/defaultPort/runUser` only.
Slice 2 *adds* `placement` (its first consumer is the generator). CVE/version columns come with the
epic that needs them — not speculatively.

## Decisions locked (this session)

- **Source of truth = literal planted pidfiles.** Per-host FS is pulled forward so the pidfile is
  a real file (not a projection). This is why the epic absorbs Story 3.
- **sshd-only** for the first cut. Other services (http/mysql/redis…) generalise later, when a
  command consumes them.
- **Walking skeleton = `sshd` brings up the LOCAL service.** Smallest blast radius; pins the
  shared format on the workstation's already-generated FS + shipped write path, before the
  generator must match it.
- **`ssh` and `sshd` are PRE-INSTALLED, not `apt`-gated** (they ship with a real Linux box).
  `ssh` (client) already exists as a `/bin` stub (`binaries.ts:48`, `SYSTEM_UTILITY_NAMES`).
  `sshd` (server daemon) is planted at generation in **`/usr/sbin/sshd`** and is **root-tier**
  (starting a daemon needs root — ties into the just-shipped `su`). Neither uses
  `availability: { kind: 'installed-package' }`.

## Acceptance Criteria (epic-level)

- [ ] A root user can run `sshd` to start the local ssh service; `/var/run/sshd.pid` is written
      with `sshd:port=22` (or the given port), and the open port is observable.
- [ ] `nmap` reports `22/tcp open ssh` for a host whose `/var/run/sshd.pid` exists, and reports
      no open ports when it does not.
- [ ] The generator deterministically plants `sshd` on a seeded subset of LAN hosts; the same
      identity + ESSID yields the same set of ssh-running hosts every reload.
- [ ] `ssh user@host` against a host running sshd validates the password against that host's
      `/etc/passwd` and, on success, lands the player in the remote machine's filesystem.
- [ ] Auth/connection failures (bad password, unknown user, port closed, host down) are reported
      with realistic messages and do not push a session.
- [ ] An `ssh` hop survives a browser refresh via the existing `sessions` rehydrate path.

---

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a failing
test. Before any code: load `tdd`, `testing`, `mutation-testing`, `refactoring`. Run `npm run lint`
(v2 has no Prettier) + `npm run test:run` + `npm run build`. Verify live through the real UI with
`agent-browser` against local `vercel dev` (NOT a unit-test-only "done").

### Slice 1 — `sshd` brings up the local ssh service (walking skeleton)

**Value**: A root player can start their own ssh daemon; the open port becomes visible — standing
up the entire pidfile primitive (format + parser + writer + one read surface) on solid ground.
**Path**: `su root` → `sshd` (root-tier command, binary at `/usr/sbin/sshd`) → writes
`/var/run/sshd.pid` (`sshd:port=22`) through the existing write/patch path → `nmap <own-ip>` reads
the **live workstation FS** pidfile and prints `22/tcp open ssh`. States intentionally skipped:
remote hosts (Slice 2), auth (Slice 3), stop/restart/status subcommands, other services.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (confirm before code):
  - `sshd` as a non-root user is denied (root-tier gate; realistic "must be root" error), no write.
  - `sshd` as root writes `/var/run/sshd.pid` containing exactly `sshd:port=22`.
  - `sshd 2222` writes `sshd:port=2222` (legacy-faithful optional port arg).
  - Running `sshd` when it is already running is reported (already running) and does not corrupt
    the pidfile. *(Confirm desired behaviour during RED — legacy parity to be checked.)*
  - `nmap <self-ip>` after `sshd` prints a `22/tcp open ssh` row under the host-up report; before
    `sshd` (no pidfile) it prints no open-port rows.
  - The `sshd` binary stub exists at `/usr/sbin/sshd` from generation (pre-installed, not apt).
**RED**: (a) pidfile **parser** unit — `parseServicePidfile('sshd:port=22') → { service:'ssh',
  port:22 }`; boundary/mutator gaps: missing `port=`, non-numeric port, custom port, trailing
  junk. (b) `sshd` command behaviour — root gate (denied non-root, no write), writes correct
  content for default + custom port, already-running case. (c) `nmap` self-scan renders the open
  port from the live FS pidfile, and renders nothing when absent.
**GREEN**: service catalog (`core/services/serviceCatalog.ts`: `ssh` row, fields
  `service/pidfile/defaultPort/runUser` only — no `placement` yet) + pidfile format module
  (`core/services/pidfile.ts`: format + parse, shared, reads catalog for name/port); `sshd`
  command (`core/commands/sshd.ts`, root tier, writes via env.fs write path); plant `/usr/sbin/sshd`
  stub in the workstation generator; extend `nmap` to read the self host's `/var/run/*.pid` from
  `env.fs` and render PORT/STATE/SERVICE rows. Minimum to pass — no remote branch yet.
**MUTATE**: `npx stryker run --mutate` on the new/changed files; produce report.
**KILL MUTANTS**: address survivors; ask when a survivor's value is ambiguous (accept documented
  equivalents per the recorded v2 patterns).
**REFACTOR**: assess only if it adds value (e.g. the nmap "host → FS → pidfiles" read may want a
  named seam now, since Slice 2 generalises it to remote hosts — but don't build the remote branch).
**Done when**: all criteria met, mutation report reviewed, lint+build+tests green, verified live
  via agent-browser (`su` → `sshd` → `nmap <self>` shows 22 open; reload-safety N/A this slice),
  human approves commit. One PR.

### Slice 2 — Generator plants sshd on remote hosts; `nmap <remote>` shows open ports

**Value**: Recon becomes real — a single-IP scan of a generated LAN host reveals whether it runs
ssh (and on what port), deterministically from the seed.
**Path**: a pure per-host FS generator (`buildRemoteHostFs(pubkey, essid, host)`) plants
`/var/run/sshd.pid` on the seeded subset of hosts that roll ssh → nmap's pidfile reader is
generalised from `env.fs` (self) to read a `Directory` tree, so a single-IP scan dispatches the
self host to `env.fs.root()` and any other host to its generated FS → `nmap <remote-ip>` prints its
open ports (`22/tcp open ssh`). Range scans stay host-discovery only (no per-host port columns),
consistent with Slice 1. Still no auth, no connect, no browsable FS.

**Decisions (locked this session):**
- **Pure probability** — each non-self host independently rolls ssh at `placement` (~0.4). No
  ≥1-per-LAN guarantee; a LAN may have zero ssh hosts (a valid outcome).
- **Mostly :22, occasionally non-standard** — an ssh host listens on `defaultPort` (22) unless a
  seeded `altPortChance` roll picks from `altPorts` (e.g. 2222/8022).
- **Pidfile-only per-host FS** — `buildRemoteHostFs` emits only `/var/run/<pidfile>` for now; the
  full skeleton (`/etc/passwd` users, `/home`, …) lands in Slice 3 when ssh's browse+auth consume it.

**Catalog columns added (their first consumer is this slice):** `placement: number`,
`altPorts: readonly number[]`, `altPortChance: number` on `ServiceSpec`. ssh:
`placement 0.4, altPorts [2222, 8022], altPortChance 0.2`.

**Self vs remote dispatch:** the player's OWN host is identified by `host.ip === wlan0.ipv4`; its
ports come from the LIVE `env.fs` (so a runtime `sshd` shows up). All other hosts are read from
`buildRemoteHostFs(...)`. The generator is pure and never sees the self host — nmap's dispatch
routes it. (Note: this supersedes Slice 1's "self-only guard" nmap test, where a sibling showed no
ports; siblings now show their OWN generated ports — that test is reworked here.)

**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (confirm before code):
  - `buildRemoteHostFs` is deterministic: same `(pubkey, essid, host)` ⇒ byte-identical `Directory`.
  - A host that rolls ssh gets `/var/run/sshd.pid` = `sshd:port=<N>` (root-owned); one that doesn't
    gets an empty `/var/run`.
  - Over a deterministic host sample the ssh fraction is ≈`placement` (a band that brackets 0.4 and
    excludes 0.3/0.5/0/1 — kills the placement literal + the threshold operator).
  - Most ssh hosts are on :22; a seeded minority on an alt port (golden host on 2222 or 8022).
  - `nmap <remote-ip>` of an ssh host prints its `PORT/STATE/SERVICE` row; of a non-ssh host prints
    no ports; the self host still reads from the live `env.fs`.
**RED**: (a) generator unit — determinism, ssh-host pidfile shape, non-ssh empty, distribution band,
  alt-port golden. (b) nmap behaviour — single-IP scan of a generated ssh host shows its port; of a
  non-ssh host shows none; self still live.
**GREEN**: catalog columns; `core/generation/remoteHostFs.ts` (`hostServices` per-`(host,service)`
  draw + port pick; `buildRemoteHostFs` → `Directory`); refactor nmap's reader to
  `readVarRunServices(root: Directory)` + a `resolveHostFs(host)` dispatch in `execute`.
**MUTATE / KILL / REFACTOR / Done when**: as Slice 1 — 100% or documented equivalents, full suite +
  lint + build green, live agent-browser (`nmap <ssh-host>` → port; `nmap <non-ssh>` → none), commit.
**Depends on**: Slice 1.

### Slice 3 — `ssh user@host` connects and drops you into the remote FS

**Value**: The headline — authenticate to and operate a remote machine. (= Story 3 + ssh auth.)
**Sub-slices** (each its own PR):
  - **3a happy path**: `ssh root@<host>` → read host `sshd.pid` (port open?) → prompt for password
    → validate against the remote `/etc/passwd` (inline md5) → push a session (the deferred
    `authCreateSession` + real `source_ip` = your wlan0 IP) → prompt reflects the remote host;
    `ls`/`cat` browse its tree.
  - **3b failures**: bad password, unknown user, connection refused (no sshd.pid), host down — each
    a realistic message, no session pushed.
  - **3c exit + refresh**: `exit` pops back to your machine; the hop survives refresh via the
    existing `sessions` rehydrate path (now carrying `source_ip` + remote cwd).
**Open decisions to settle before 3a** (parked — do not block Slices 1–2):
  - How `ssh` collects the password — interactive prompt (matches real ssh + our async-command
    pattern) vs other. Real ssh has no positional password (cf. the deferred inline-`su user pw`).
  - Is `source_ip` always the player's wlan0 IP? (cross-network realism per
    `feedback_log_source_ip_realism`).
  - Cascade-end semantics for child sessions on disconnect.
  - Widen `core/sessions/createSession.ts` `kind` schema past `z.literal('su')` to include `'ssh'`.
**Depends on**: Slices 1–2.

---

## Parking lot (later epics / slices — NOT in scope now)

`ps`/`kill` reading pidfiles; other services (nginx http/https, mysql, redis, …) + their pidfiles;
`sshd` stop/restart/status subcommands; cross-player "be reachable" (multiplayer); foreign-subnet
hops + multi-layer depth (generator Story 4); CVEs/vuln timelines; missions.

## Pre-PR Quality Gate (each slice)

1. Mutation testing (`mutation-testing` skill) — report reviewed, survivors addressed/documented.
2. Refactoring assessment (`refactoring` skill).
3. `npm run lint` + `npm run test:run` + `npm run build` green (v2 — no Prettier).
4. Live agent-browser verification through the real UI (per `feedback_e2e_test_new_primitives`).
5. Version bump (`package.json` + `package-lock.json`) per the project's semver-on-feature rule.

---

_Delete this file when the epic's slices are all shipped (or fold remaining slices into their own
plan files). If `plans/` is empty, delete the directory._
