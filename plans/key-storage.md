# Plan: where a contract keeps its key

**Status:** Grilled 2026-11-09. Two slices planned 2026-11-09. Nothing is built.

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
   - **A database is a file, and that is accepted.** A v2 database is the root-only
     `/var/lib/mysql/data.json`, with no per-table grants: any database login reads every table. So on
     the mysql route a database key is reached by cracking the application login with `hydra` and a
     `SELECT`, with no `ssh` and no root, the easiest pairing and the new play. On the other five
     routes a root reads the key out of `data.json` with `cat` or `grep`, close to the plain file.
     Nobody can tell the storage before looking. No `/root/.my.cnf`: the database root password comes
     from the pool that must never leak.
   - **The database key** is a row in an `api_keys` table (legacy's name) with a few decoy rows not in
     the `ACCESS-` shape. Off the mysql route the key box still gets a database: a mysqld on a safe
     release with no forward, its root uncrackable.
   - **The gpg program's content** is the ELF stub header, its name, and a few lines of its own: a
     usage line, `--seal`, `--open`, and the passphrase. NUL-free, like every binary stub (a root's
     edit goes to a Postgres TEXT column).
   - **The history line names no secret**, so it can be generated in `core/`. The program and the
     encrypted key are laid in by the server, as the key file is.
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
- **On the mysql route**, the datadir holds both `settings` (root's word, as today) and `api_keys`:
  the application login a `hydra` sweep finds reads the key with `SELECT * FROM api_keys`, with no
  `ssh`.
- **On every other route**, the key box runs a `mysqld` on a safe release, listening on `3306`, with
  no forward on the gateway. Both of its database accounts are drawn from `SHUT_HASHES`, so no sweep
  from a guest shell on the box opens it; a root reads the key from `/var/lib/mysql/data.json`.
- A root's `DROP TABLE api_keys` or `rm` of the datadir closes the job for later visitors.
- With `MISSION_KEY_SECRET` unset, the datadir door answers 500 `mission_secret_missing`.
- `hireme.ts show` prints `Storage: database`.
- Slice 1's treatment of `database` as `file` is removed.

**Shape**

- `missionShape`: on `database` off the mysql route, the key box gains the database server on a safe
  release and a `keyBoxDatabase` with both hashes from `SHUT_HASHES`. Its forwards are unchanged.
- `missionLeak.ts`: the datadir is built once from every table the contract's route and storage put
  in it (`settings` on the mysql route, `api_keys` on database storage), so the two never compete
  for the same file; `missionFilePaths` lists the datadir on every contract that has one.

**TDD order (RED first)**

1. `missionShape` on database storage, every route: the database server present on a safe release,
   no new forward, both hashes shut off the mysql route.
2. `missionFiles`: the datadir carries `api_keys` with the key and the decoys, and on the mysql route
   `settings` as well; no key file.
3. The database statements on the laid datadir: `SELECT` from `api_keys` as the application account
   on the mysql route; access denied for any sweepable word off it.
4. `missionFilePaths` and the write gate for the datadir; 500 with the secret unset.
5. `showReport`: `Storage: database`.

**Gates**

- As slice 1, with `scripts/testMissionMysql.ts` gaining a mysql-route database contract (the
  application login reads the key, the mail pays) and `testMissions.ts` an other-route one (root
  reads the datadir, the mail pays).
- Mutation gate on the changed lines. Version bump to v0.448.0.

**Docs**

- `missions-architecture.md`: the storage section gains the database, including that the mysql
  route reaches it without root.

---

## Close-out

One browser run on a fresh player, contracts staged with `hireme.ts accept --number N`:

- a gpg job: root, `ls /usr/local/bin`, `cat ~/.bash_history`, `strings` on the program, `gpg -d`,
  mail, paid once;
- a database job on the mysql route: `hydra` the application login, `SELECT` the key, mail, paid
  with no `ssh`;
- a database job on another route: root, read the datadir, mail, paid.

Then the shipped items in `project-status.md`, the "missions — deferred" entry in `backlog.md`
trimmed, a valleynews `/dev` note if the owner wants one, and this plan retired.

## Carried risks

- **Off the mysql route, the database's application account is shut too.** The grill fixed only the
  database root as uncrackable. A crackable application login on a box with no forward would still
  open the key to anyone holding a guest shell there who can sweep `localhost`, a way in that is not
  the route. Shutting both keeps "nothing but the route climbs". Confirm at slice 2's start.
- **Slice 1 treats `database` as `file`.** Merged alone, about a third of contracts play as plain
  file jobs until slice 2. Free while prod has only test players.
