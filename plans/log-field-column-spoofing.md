# A log field cannot fake the columns stamped after it — grill record + plan

**Status:** Active — slice 1 built on `feat/log-field-escaping` (v0.404.0), in review; close-out
browser run pending.

Goal: the one item still open in the sandbox-hardening list's item 8 (`docs/project-status.md`)
and recorded in `docs/backlog.md` under the trace-field work — "a field can spoof the columns
that follow it WITHIN its own line (a path ending `", 0 bytes`), though the columns the server
stamped are still there to contradict it." Found by reading at the close of the v0.366.0
line-break work, not yet played.

Facts established before the grill:

- v0.366.0 closed the sibling hole: a line break inside a caller-sent field is written out as
  `\n`/`\r` text by `onOneLine` in `appendMachineLog`, so a field can no longer end its line early
  and forge a whole new line (`appendMachineLogLines`, several lines handed over apart). That fix
  lives at the one place every line lands — but it works only because newline-stripping needs no
  knowledge of where a field ends. Column-spoofing does: `onOneLine` sees one joined string and
  cannot tell a field from the separator the server put beside it.
- A trace line is `<server columns> <caller field> <more server columns>`. The server stamps the
  trustworthy columns — timestamp, source IP, pid, status, byte count, outcome verb. A caller
  field that sits before one of them can, with an ordinary separator character, print text that
  reads as that column: a vsftpd path `/x", 0 bytes` renders `"/x", 0 bytes", 42 bytes`, a login
  username `root from 9.9.9.9` renders `Failed password for root from 9.9.9.9 from <realip>`. The
  real column still follows and contradicts it, so this is a forensic-integrity gap, not an
  exploit — the same class the owner already chose to close for line breaks.
- Separators differ by format: `"` (vsftpd path, access request), `'` (`'user'@'ip'` in
  `mysql.log`), space (the bare package/version tokens in `dpkg.log`, the `kernel: <cmd>[pid]`
  and `<host> <service>[pid]` heads of a syslog line), `[`/`]`, `\t` (mysql columns), `@`, the
  ` -> ` of an snmp SET, and `\` itself.
- Which fields are caller-text and which the server owns, confirmed by reading every formatter
  and its call sites:
  - **Caller-controlled, mid-line:** the requested `path` (`formatAccessLogLine`,
    `formatVsftpdTransferLine`); the `user`/`targetUser`/`fromUser` an attacker types at a login
    (`formatSshdAuthLine`, `formatSuAuthLine`, `formatVsftpdLoginLine`, `formatMysqlConnectLine`,
    `formatMysqlAttemptLine`) and the own-box `user` of a session-opened line
    (`formatSessionOpenedLine`); the `packageName`/`fromVersion`/`toVersion` of a service
    downgrade (`formatPackageDowngradeLine`, client-reported — the firmware path derives them
    server-side but renders through the same formatter); the segfault `command`/`library`
    (`formatSegfaultLine`); the box `hostname` that heads every syslog line (`formatSyslogLine`,
    and the inline kern heads `formatRebootLine`/`formatSegfaultLine`/`formatKernelLine`); and the
    essid-derived `zone` in `named.log` (`formatNamedXfrLine`). `hostname`, the own-box `user`
    and the `essid` are all `z.string().min(1)` at the server boundary — player-chosen at
    onboarding, not constrained to safe characters, and a crafted signed request bypasses the UI.
  - **Server-owned or already safe, left alone:** source IP, pid, timestamp, status, byte count
    and every outcome verb (server-stamped); the HTTP `method` and the ftp `direction` (closed
    sets); the snmp SET `oid`/`previous`/`current` (computed by `describeSet` from a parsed
    target, never free text); the database an accepted mysql connection names (read off the box);
    the redis mutation `detail` (collapsed, bounded and stripped of line-enders by the verb table
    before it reaches the formatter); and the mysql/redis `statement` (end-of-line — nothing is
    stamped after it to fake).

## Decisions

1. **Escape, don't refuse.** A caller field that carries a separator is written out with that
   separator neutralised, and the line still lands — the attempt itself stays on record, exactly
   as v0.366.0 chose for line breaks. Rejected: refusing the request at the boundary, which would
   turn an odd username or path into an error a defender never sees, and change gameplay for a
   forensic fix.
2. **One maximal set everywhere, as an allowlist complement.** A single rule for every field: a
   character in a conservative safe set passes through, anything else becomes `\xNN`. No per-format
   judgement about which separator this field's slot cares about — the quote that matters to the
   vsftpd path and the space that matters to the dpkg token are both simply "not in the safe set".
   Rejected: a context-aware rule (quoted fields escape only `"`/`'`/`\`, bare fields also escape
   whitespace), which reads legit values more naturally but makes each formatter declare its slot's
   context — a per-field judgement that can be got wrong later.
3. **Safe set `[A-Za-z0-9/._:+~=?&%-]`; everything else → `\x` + two lowercase hex per UTF-8
   byte.** The set is the union of what legit field content needs — paths (`/._-?=&%:~`), Debian
   versions (`.:-~+`), package and account and host names (`-_.`), the `.lan` zone — so a real log
   reads unchanged; a space in a path shows `\x20`, which is rare and cosmetic. `\` is outside the
   set, so it escapes to `\x5c` and the encoding is unambiguous and reversible. Non-ASCII escapes
   per UTF-8 byte the way a web server logs bytes, and is covered for free by being outside the
   set. Rejected: a denylist of known separators (brittle — a new format with a new separator is
   a silent hole); escaping only ASCII separators (leaves the allowlist's own promise half-kept).
4. **The rule lives per field, in the formatters — one shared `escapeLogField`, called at each
   site — not in `appendMachineLog`.** By the time a line reaches `appendMachineLog` the fields are
   joined and a field is indistinguishable from a separator, so the escape must happen where the
   field is still a distinct value: the formatter that interpolates it. `onOneLine` stays at
   `appendMachineLog` as the backstop for the structural remainder and for the end-of-line fields
   left unescaped; an escaped field carries no raw `\r`/`\n` for it to touch, so the two never
   collide. Rejected: a branded `EscapedField` type the formatters demand, which would force every
   call site to escape by construction but spreads new machinery across every log-event type for a
   rule a per-formatter test and the mutation gate already hold; and moving the rule into
   `appendMachineLog`, which cannot see field boundaries.
5. **Every caller-text field is in scope, including the box's own `hostname`, the own-box
   session `user`, and the essid-derived `zone`** — not only the fields a visitor injects into
   someone else's log. All of them land in a shared log a rooted box's intruder reads as evidence,
   so the rule that "a log a caller can author is not evidence" applies to the owner-chosen
   identity fields too. Escaping them at the formatter keeps the chosen approach (no gameplay
   change) rather than constraining a player's chosen name at onboarding, which is the refusal
   decision 1 already declined. Rejected: scoping to visitor-injected fields only and deferring
   hostname/username/essid as a separate concern.
6. **End-of-line fields stay as they are.** The mysql/redis `statement` has nothing stamped after
   it to fake, and the redis `detail` is already bounded and stripped upstream, so neither is
   touched — adding the escape there would mangle a legitimate SQL or redis statement for no
   integrity gain. Rejected: escaping every caller field regardless of position, for a uniformity
   that costs readability where there is no column to protect.

Consequences, confirmed with the decisions: a defender's `vsftpd.log`, `access.log`, `auth.log`,
`mysql.log`, `dpkg.log`, `kern.log` and `named.log` can be read column by column and trusted — the
timestamp, source IP, pid and verdict the server stamped cannot be impersonated by anything a
caller typed, nor by a box's own chosen name. The backlog item's "still open" note is closed. No
new state, no gameplay change: every command answers exactly as it does today, and a crafted field
simply reads with its separators spelled out.

Resolved while planning:

- **`escapeLogField` is its own module, `src/core/logging/escapeLogField.ts`.** It is imported by
  every formatter file and by `syslog.ts`; a leaf module everything depends on reads cleaner than
  routing the import through `syslog.ts`.
- **`hostname` is escaped once, inside `formatSyslogLine`** — the shared head of the sshd, su,
  root-session and snmpd lines, so those get it for free. The three kern heads
  (`formatRebootLine`, `formatSegfaultLine`, `formatKernelLine`) and `formatNamedXfrLine` compose
  their head inline rather than through `formatSyslogLine`, so each escapes its own `hostname`/
  `zone`.

## Slice 1 — a caller field cannot fake a column (v0.404.0)

**Value:** a defender reading `vsftpd.log`, `access.log`, `auth.log`, `mysql.log`, `dpkg.log`,
`kern.log` or `named.log` can trust each column — the timestamp, source IP, pid and verdict the
server stamped cannot be impersonated by a path, a username, a package name, an exploit's command
or a box's own chosen name, however it was crafted. The line still lands; the forgery reads with
its separators spelled out.
**Path:** every server trace that renders a caller-text field runs it through one
`escapeLogField` before interpolation — the fetch/sweep handlers (`access.log`), the ftp
transfer/login (`vsftpd.log`), the cross-player and own-box login/`su`/session-opened lines
(`auth.log`), the mysql connect/attempt lines (`mysql.log`), the service-downgrade line
(`dpkg.log`), the segfault line (`kern.log`), the zone-transfer line (`named.log`) — then the
existing `appendMachineLog`/`onOneLine` path lands it unchanged.
**Class:** behavior change (the rendered log line changes for a crafted field; unchanged for every
legitimate one). **Delivery:** independent PR against `main`.
**Required skills:** `tdd`, `testing`, `functional` (the escape is a pure string transform),
`refactoring` (folding the per-field calls cleanly into each formatter).
**Acceptance criteria** (observable in the log a reader sees):
- A `/var/log/vsftpd.log` transfer line built from a download path `/x", 0 bytes` reads the path
  with its quote escaped (`\x22`) so the real `", <N> bytes` the server stamped is the only byte
  count on the line; the same for the path and account in a login line.
- A `/var/log/auth.log` line from an ssh/`su` login whose typed username is `root from 9.9.9.9`
  names that whole string as the user with its spaces escaped, so the `from <real source IP>` the
  server stamped is the only source on the line; the session-opened line on the player's own box
  escapes its username the same way.
- A `/var/log/access.log` line from a fetch or sweep whose requested path carries a `"` or a space
  reads the path escaped, so the `" <status> <size>` the server stamped cannot be faked; a crafted
  sweep account in a 401 line is escaped too.
- A `/var/log/dpkg.log` service-rollback line whose package name or version carries a space or a
  quote reads them escaped, so the `Client "<ip>"` the server stamped is the only client on the
  line.
- A `/var/log/kern.log` segfault line escapes a crafted command or library, and every syslog-headed
  line escapes a box `hostname` that carries a space or bracket, so the `<service>[<pid>]:` the
  server stamped is the only service head on the line.
- A `named.log` zone-transfer line escapes an essid-derived `zone` that carries a separator.
- Every legitimate field — an ordinary path, `www-data`, `openssh-server`, `7.9.7`, a plain
  machine name, a `.lan` zone — renders exactly as it does today. A space inside a field reads as
  `\x20`; nothing else in a normal log changes.
- Live, against `vercel dev` + supabase (`scripts/testLogFieldEscaping.ts`): one player crafts a
  username at a cross-player ssh login and a path at an occupant fetch against another player's
  box; the victim's `auth.log` and `access.log` hold the attempt with every separator escaped and
  the server's own columns intact.
**RED:**
1. `escapeLogField.test.ts` — a safe-set character passes; each separator (`"`, `'`, space, `[`,
   `]`, `\t`, `@`, `\`, control) and a multibyte char render as `\xNN` (per UTF-8 byte); `\`
   becomes `\x5c`; a realistic path/version/name is unchanged.
2. One case per formatter in its existing `*.test.ts` (`vsftpdLog`, `accessLog`, `authLog`,
   `mysqlLog`, `dpkgLog`, `kernLog`, `syslog`, `namedLog`): a crafted field, asserting the
   separator is escaped and the server-stamped columns survive to the right of it.
3. The wire-check, run first against today's code — the live probe the grill named — showing the
   raw separators land in the victim's logs.
**GREEN:** the `escapeLogField` module (a safe-set regex, `Array.from` over code points, UTF-8
bytes to `\xNN` for anything outside it); then one `escapeLogField(...)` call around each
caller-text field named in the facts — `hostname` once inside `formatSyslogLine`, the kern/named
heads escaping their own.
**REFACTOR:** assess whether the handful of formatters that escape several fields read better with
the calls inline at interpolation or hoisted to named locals; keep `onOneLine` as the backstop
(an escaped field leaves it no raw newline to touch).
**Existing wire-checks to re-run** (each lands a line through a formatter now wrapped, with only
safe-char fields, so each must read byte-identical): `testOccupantFetch.ts`, `testOccupantSweep.ts`,
`testFtpCrossPlayer.ts`, `testAptDowngradeTrace.ts`, `testSharedBoxLogTruth.ts`.
**PRE-PR MUTATION:** Stryker on `escapeLogField.ts` (the safe-set regex boundary, the hex padding,
the per-byte loop) and one or two representative formatters, json reporter, one file at a time.
**Docs:** `conventions-and-gotchas.md` (a one-line invariant: every caller-text field in a shared
log goes through `escapeLogField`, beside the `onOneLine` line-break rule); `backlog.md` (close
the "still open" trace-field note, pointing here until close-out); `project-status.md` item 8 (the
last sub-item closed); `cross-player-architecture.md` where it records the line-break escape, to
add the column escape beside it.
**PR-ready when:** `npm run typecheck`, `npm run lint`, full vitest green; the new wire-check and
the five above pass live; version bumped in `package.json` and `package-lock.json`; the owner
approves the commit.

## Close-out

One browser run, two players on a shared WiFi: B attacks A's box with a crafted username at an ssh
login and a crafted path at a `curl`/`ftp`; A (or B after rooting A) reads A's `auth.log`,
`access.log` and `vsftpd.log` and finds the attempt recorded with every separator spelled out and
the real source IP, byte count and verdict standing uncontradicted. A normal attack in the same run
reads exactly as before. Then the `project-status.md` item 8 entry, the backlog note, and this file
deleted.
