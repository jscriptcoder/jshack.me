# A log field cannot fake the columns stamped after it — grill record + plan

**Status:** Active — grilled 2026-10-18, no slice started.

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

### Open for the plan

- Whether `escapeLogField` is its own module in `core/logging/` or sits beside `formatSyslogLine`
  in `syslog.ts` (both are imported widely).
- Whether `hostname` is escaped once inside `formatSyslogLine` (covering sshd/su/root-session/
  snmpd) with the inline kern heads escaping it themselves, or every head escapes its own.
