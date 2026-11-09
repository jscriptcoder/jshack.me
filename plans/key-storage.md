# Plan: where a contract keeps its key

**Status:** Grilled 2026-11-09; slice 2 re-grilled 2026-11-09 (decision 6). Two slices planned.
Slice 1 (v0.447.0) merged as #758 on 2026-11-09. Its wire-check found the
msfconsole route's ftp draw unwinnable, fixed first in #757 (v0.446.1). Slice 2 (v0.448.0) merged as
#759 on 2026-11-09. The close-out browser run is next.

**Slice 2 as built:** as planned. The key is the `portal` row of `api_keys`, beside `stripe`,
`sendgrid` and `mapbox` keys drawn from the number. Off the mysql route the database is drawn after
everything else in `missionShape`, so the route reads the same whatever the storage. `show` prints
`Storage:  database, table api_keys`, and its key path is the datadir. `DROP TABLE` is database
root's alone, which stays shut, so the job is closed by the account's `DELETE` or a box root's `rm`
of the datadir; both are wire-checked.

**Slice 1 as built:** as planned, except that root's `.bash_history` is laid by the server (it names
the key path, which never ships), so the key box's base is unchanged and `/usr/local/bin` exists only
where the program lands. The program's runs are separated by U+0001. The four leak-route wire-checks
pin their numbers to plain-file contracts, since they read the plain key path. Running the program
answers as any binary with no command behind it (`No such file or directory`).

Today every contract keeps its `ACCESS-` key the same way: a root-only text file on the key box. Legacy
also kept it encrypted (`gpg`, its passphrase on another machine, sometimes wrapped in binary noise
that only `strings` reads) and in a database table (`db_exfiltrate`, an `api_keys` row). This epic
brings both back as a second draw beside the route. As-built context:
[`docs/missions-architecture.md`](../docs/missions-architecture.md); legacy's design:
[`docs/mission-ideas/objectives.md`](../docs/mission-ideas/objectives.md) and `legacy-final`'s
`src/generation/binary.ts`.

---

## Grill record

1. **A second draw, independent of the route (2026-11-09).** `missionShape` draws where the key is
   stored, `file` (today's), `gpg` or `database`, beside `route`, and neither knows about the other:
   six routes times three storages. Rejected: each storage as its own template with its own route
   rules (the database key only on the mysql route, and so on), which is more rules for fewer
   combinations.

2. **The gpg passphrase lives on the key box, in a fake program (2026-11-09).** The gateway is built
   to stay shut, so it cannot hold the passphrase without a second way in. The key box carries
   `/usr/local/bin/<stem>-vault` (the client's target stem, as in `halden-vault`), root-owned, mode
   755, binary-looking: `strings` on it prints the usual ELF lines plus a few of its own, one of which
   is the passphrase. The encrypted key sits where the plain key sits today, root-only, with `.gpg`
   on the end; the plain file is gone. A guest can read the program, which costs nothing because the
   encrypted key stays root-only. Rejected: a third box behind the key box, which is the deep-chains
   template and waits for it.
   - **Why `strings` is the only way in:** `grep` skips any file that starts with the ELF magic
     (`core/commands/grep.ts`), even under `-r`, so the passphrase cannot be grepped out of it.

3. **Two things point at the program (2026-11-09).** It sits alone in `/usr/local/bin`, where nothing
   else on the box lives, and root's `.bash_history` carries `<stem>-vault --seal <key path>` then
   `rm <key path>`. Neither says the passphrase is inside it or that `strings` reads it: the player
   still makes both leaps. Rejected: the lone file only (no thread for a player who never lists that
   directory); the history line only.

4. **The passphrase is derived per contract from `MISSION_KEY_SECRET` (2026-11-09).** An HMAC of the
   contract number under a label of its own (not the key's), formatted `hv-XXXX-XXXX` in Crockford's
   alphabet. Stored nowhere, known only to the server, like the key; one job's passphrase says nothing
   about the next. The ciphertext comes from the existing `gpg` codec in `core/`, the one the player's
   `gpg -d` opens. Rejected: a word from a pool, which players would collect and so skip `strings`.

5. **The owner took every remaining recommendation (2026-11-09):**
   - **A database is a file** (still true): a v2 database is the root-only `/var/lib/mysql/data.json`,
     with no per-table grants, so any database login reads every table and a root reads the key out
     of `data.json`. No `/root/.my.cnf`: the database root password comes from the pool that must
     never leak. What the grill first drew from this, that off the mysql route the database is only
     reached through root, is replaced by decision 6.
   - **The database key** is a row in an `api_keys` table (legacy's name) with a few decoy rows not in
     the `ACCESS-` shape. Where the database runs and how it is reached: decision 6.
   - **The gpg program's content** is the ELF stub header, its name, and a few lines of its own: a
     usage line, `--seal`, `--open`, and the passphrase. NUL-free, like every binary stub (a root's
     edit goes to a Postgres TEXT column).
   - **The history line is laid in by the server**, with the program and the encrypted key. (The
     grill said it could be generated in `core/` because it names no secret; it names the key path,
     whose pool is server-only, so it cannot. Corrected while building slice 1.)
   - **The draw is flat, one in three**, and exactly one storage per contract, never two combined.
   - **Pay and the offer do not change**, so pay gives no hint of the storage, the rule leak routes
     already follow.
   - **The briefing does not change.** Players learn by finding out.
   - **Completion does not change:** the mailed key is compared with the contract's key, so mailing
     the encrypted text fails like any wrong key.
   - **Closing a job:** a root's `rm` of the program or the `.gpg` file closes the job for later
     visitors, as `rm` of the key does today. Both paths join the write gate's mission files.
   - **No secret, no file:** the program, the encrypted key and the datadir answer 500
     `mission_secret_missing` like the key.
   - **The operator:** `scripts/hireme.ts show` prints the storage, and for `gpg` the passphrase, as
     it prints the key. `/etc/hireme/contracts` does not change.
   - **The re-roll is accepted.** Adding the draw changes every contract's network, never its address
     or key; free while prod has only test players.
   - **Two slices.** Slice 1: the draw, with `file` and `gpg`. Slice 2: `database`. Each its own PR,
     version bump, unit tests, a wire-check against `vercel dev` and the mutation gate; one browser
     run at close-out works a gpg job and a database job, including the mysql-route pairing.

6. **A database contract is worked from outside, as a database user, never as root (2026-11-09).**
   The point of the database key is to reach the database from another box with `mysql`, not to root
   the key box and read `data.json`. So every `database` contract forwards `:3306` on the gateway,
   whatever its route, and its application account's password is drawn from the crackable pool, as on
   the mysql route: `hydra <address> mysql`, then `mysql <address> <user>`, then
   `SELECT * FROM api_keys`. The database root stays shut. The route is still drawn and still roots
   the box, so a root can also read the key out of `data.json`: a database contract has two ways to
   the key, and the login one never needs a shell. A database login reads tables and grants no shell,
   so nothing climbs that should not. A scan shows `3306` beside the route's ports (on the mysql route
   it already was its door). This replaces decision 5's "a database is a file, and that is accepted"
   and its database-key bullet, and closes the carried risk about the application account.
   Rejected: a login the route gives away on the box (an app config, a `.my.cnf`), which needs a
   shell on the box; a leak route leaking the database password instead of root's word, which leaves
   hydra and msfconsole contracts needing a sweep anyway. Both stay candidates for the deferred
   "harder leaks".

## Where the key is made today (found 2026-11-09)

- `src/core/missions/missionShape.ts`: `missionShape(number)` draws `stem`, `keyBoxOctet`, `route` on
  the `mission-shape-<n>` stream (fixed order, `generateHomeLan` reads the first two), and versions,
  hashes and services on `mission-versions-<n>`.
- `src/core/missions/missionSecret.ts`: `missionKey` (HMAC-SHA256 of `String(number)` under
  `MISSION_KEY_SECRET`), `missionKeyPath` (its own `mission-keypath-<n>` stream).
- `src/core/missions/missionLeak.ts`: `missionFiles` (key plus leak, server-only),
  `missionFilesForBox` (what `api/network.ts` and `api/sessions.ts` call), `missionFilePaths` (the
  write gate's list, read by `api/patches.ts`). The mysql route's leak file IS the whole datadir
  (`databaseWithWord`): a door replaces the datadir, never merges into it.
- `src/core/generation/missionKeyBoxFs.ts`: `buildMissionKeyBoxFs`, the key box's base. `/root` is an
  empty `ROOT_DIR`; the datadir exists only when `shape.keyBoxDatabase` is set (mysql route).
- `src/core/commands/gpg.ts`: the codec, `encryptContent`/`decryptContent`, is private to the
  command today.
- `src/core/generation/binaries.ts`: `STUB_HEADER`, the NUL-free ELF header every stub starts with;
  `grep` skips content that starts with the ELF magic.
- `src/core/missions/hiremeOrders.ts`: `showReport`, which `scripts/hireme.ts show` prints.
- Wire-checks: `scripts/testMissions.ts` (the key door) and `scripts/testMissionMysql.ts` (the
  database route) are the two these slices extend.

---

## Slice 1 — the draw, and the gpg chain (v0.447.0)

One PR, branch `feat/key-storage-gpg`. The server lays two new files, so the `api/` doors change what
they serve and the wire-check runs before merge.

**Acceptance criteria**

- `missionShape(n).storage` is one of `file`, `gpg`, `database`, flat, drawn on a stream of its own
  (`mission-storage-<n>`), so no route, version, hash or topology draw shifts. Until slice 2 lands,
  the one place that reads it treats `database` as `file`, so no contract carries a half-built
  storage; the draw itself is final.
- On a `file` contract the key box is exactly as today.
- On a `gpg` contract:
  - `<key path>.gpg`, root-only (`ROOT_FILE`), holds the key encrypted with the contract's
    passphrase; `gpg -d <key path>.gpg <passphrase>` prints `ACCESS-…`, and any other passphrase is
    refused as it is for any file. Nothing sits at the plain key path.
  - `/usr/local/bin/<stem>-vault`, root-owned, mode 755, starts with `STUB_HEADER`, then its name, a
    usage line naming `--seal` and `--open`, and the passphrase, each a run `strings` prints on its
    own line. It holds no NUL byte. `grep -r hv- /` as root does not find it.
  - It is the only entry in the box's `/usr/local/bin`.
  - Root's `/root/.bash_history` ends with `<stem>-vault --seal <key path>` then `rm <key path>`.
  - The passphrase is `hv-XXXX-XXXX` in Crockford's alphabet, an HMAC-SHA256 under
    `MISSION_KEY_SECRET` of a message distinct from the key's (`passphrase:<n>`).
- With `MISSION_KEY_SECRET` unset, every door that lays the files answers 500
  `mission_secret_missing` on a gpg contract, as it does on a file contract.
- A root's `rm` of the `.gpg` file or the program sticks for the next reader; a guest's write to
  either is refused (`missionFilePaths` lists both on a gpg contract, and no longer the plain key
  path).
- Mailing the decrypted key completes and pays; mailing the encrypted text gets the wrong-key reply.
- `hireme.ts show` prints `Storage: gpg` and `Passphrase: hv-…` beside the key, and `Storage: file`
  on a file contract.
- The offer, the pay, the briefing and `/etc/hireme/contracts` are unchanged.

**Shape**

- `missionShape`: `storage: MissionStorage`, from `STORAGES = ['file', 'gpg', 'database'] as const`.
- The codec moves out of `commands/gpg.ts` into `src/core/crypto/gpgCodec.ts` (`encryptContent`,
  `decryptContent`), behaviour unchanged, so the server imports it without importing a command. A
  pure move in its own commit: `gpg.test.ts` stays green before and after.
- `missionSecret.ts`: `missionPassphrase(number, secret)` beside `missionKey`.
- `missionLeak.ts`: `missionFiles` returns the key file on `file`, and the `.gpg` file plus the
  program on `gpg`; `missionFilePaths` matches it from the number alone. One function builds the
  program's content from the stem and the passphrase. If `missionLeak.ts` stops reading as one
  thing, the storage half moves to a sibling module.
- `missionKeyBoxFs.ts`: on `gpg`, `/root/.bash_history` with the two lines (no secret in it, so it
  belongs in the base) and an empty `/usr/local/bin` for the server's file to land in.
- `showReport` gains the two lines.

**TDD order (RED first, each at its public surface)**

1. `missionShape`: storage is one of three, the same for the same number, and every route still
   draws as before for a sample of numbers (the stream is separate); over a large sample each
   storage lands near a third.
2. `missionPassphrase`: its format, stable per number, different across numbers and from the key.
3. The codec move (refactor, green throughout): `gpg.test.ts` unchanged.
4. `missionFiles` on a gpg contract: the `.gpg` file decrypts through the codec with the passphrase
   to the key; the program's `strings` runs include the passphrase; no NUL; it starts with
   `STUB_HEADER`; no plain key file. `missionFilePaths` agrees with `missionFiles`'s paths on every
   storage.
5. `buildMissionKeyBoxFs` on a gpg contract: the history lines, and `/usr/local/bin` empty in the base.
6. The doors, through `missionFilesForBox`: a gpg key box's files, and 500 with the secret unset.
7. Commands on the laid box (`strings`, `grep -r`, `gpg -d`, `cat` of the `.gpg`), through the
   remote-shell harness the leak routes' tests already use.
8. `showReport`: the two new lines.

**Gates**

- `npm run typecheck`, `npm run lint`, the full suite, `npm run build` with `checkBudgets`. Raise
  `BUNDLE_CEILING_BYTES` by what the build needs (owner: size is not a problem).
- Wire-check: `scripts/testMissions.ts` gains a gpg contract staged by the operator (`hireme.ts
  accept --number N` on a number whose storage is `gpg`): root reads the `.gpg` file and the
  program, `gpg -d` with `show`'s passphrase gives `show`'s key, and the mail pays once.
- Mutation gate on the new and changed `core/missions` lines and `gpgCodec.ts`.
- Version bump to v0.447.0 in `package.json` and `package-lock.json`.

**Docs**

- `missions-architecture.md`: a section on where the key is stored (the draw, the gpg chain, why
  `strings`), §3 and §8 updated, and "To add a storage" beside "To add a route".
- `project-status.md` gains the shipped item.

---

## Slice 2 — the key in a database (v0.448.0)

One PR, branch `feat/key-storage-database`. The datadir becomes a server-written file on every
database contract, so the `api/` doors change what they serve and the wire-check runs before merge.

**Acceptance criteria**

- On a `database` contract no key file is laid; the key is a row of an `api_keys` table in the key
  box's datadir, beside a few decoy rows whose values are not in the `ACCESS-` shape.
- **On every route**, the key box runs `mysqld` on a safe release and the gateway forwards `:3306` to
  it, beside the route's own forwards. Its application account's password is from the crackable pool
  and its database root from `SHUT_HASHES`. From the player's own box, `hydra <address> mysql` finds
  the application login, `mysql <address> <user>` logs in, and `SELECT * FROM api_keys` shows the key,
  with no shell on the key box.
- **On the mysql route** the database is the one it already runs: the datadir holds both `settings`
  (root's word, as today) and `api_keys`, and the forward is the one it already has.
- **The route still roots the box**, and a root reads the key out of `/var/lib/mysql/data.json`.
- A root's `DROP TABLE api_keys` or `rm` of the datadir closes the job for later visitors.
- With `MISSION_KEY_SECRET` unset, the datadir door answers 500 `mission_secret_missing`.
- `hireme.ts show` prints `Storage: database`.
- Slice 1's treatment of `database` as `file` is removed.

**Shape**

- `missionShape`: on `database` off the mysql route, the key box gains the database server on a safe
  release, a `keyBoxDatabase` drawn as the mysql route's is (application account crackable, root
  shut), and a `3306 -> 3306` forward after the route's own.
- `missionLeak.ts`: the datadir is built once from every table the contract's route and storage put
  in it (`settings` on the mysql route, `api_keys` on database storage), so the two never compete
  for the same file; `missionFilePaths` lists the datadir on every contract that has one.

**TDD order (RED first)**

1. `missionShape` on database storage, every route: the database server present on a safe release,
   a `3306` forward (exactly one on the mysql route), the application account crackable and the
   database root shut.
2. `missionFiles`: the datadir carries `api_keys` with the key and the decoys, and on the mysql route
   `settings` as well; no key file.
3. The database statements on the laid datadir: `SELECT` from `api_keys` as the application account,
   on the mysql route and off it.
4. `missionFilePaths` and the write gate for the datadir; 500 with the secret unset.
5. `showReport`: `Storage: database`.

**Gates**

- As slice 1, with `scripts/testMissionMysql.ts` gaining two database contracts, one on the mysql
  route and one on another route. On each, from the player's own box: a scan shows `3306`, a sweep
  finds the application login, `SELECT` from `api_keys` returns the key `show` prints, and the mail
  pays. On the other-route one, root also reads the key out of the datadir.
- Mutation gate on the changed lines. Version bump to v0.448.0.

**Docs**

- `missions-architecture.md`: the storage section gains the database: worked from outside as a
  database user, the forward it adds to every route, and the second way through root.

---

## Close-out

One browser run on a fresh player, contracts staged with `hireme.ts accept --number N`:

- a gpg job: root, `ls /usr/local/bin`, `cat ~/.bash_history`, `strings` on the program, `gpg -d`,
  mail, paid once;
- a database job on the mysql route and one on another route, each from the player's own box:
  `nmap` shows `3306`, `hydra <address> mysql`, `mysql <address> <user>`, `SELECT` the key, mail,
  paid, with no `ssh`;
- on the second, also root by the route and read the datadir.

Then the shipped items in `project-status.md`, the "missions — deferred" entry in `backlog.md`
trimmed, a valleynews `/dev` note if the owner wants one, and this plan retired.

## Carried risks

- ~~Off the mysql route, the database's application account is shut too.~~ Closed by decision 6:
  the application login is the intended way to the key, from outside.
- ~~Slice 1 treats `database` as `file`.~~ Closed by slice 2.
