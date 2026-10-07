# 5. The shell, the command framework, and the command catalog

This chapter explains how a typed line becomes command execution: the shell parser, the `Command`
contract, how a command is found and gated, how pipes and redirects work, how the `node` scripting
sandbox exposes commands to player scripts, and how `apt` and the wordlist fit in. It ends with a
catalog of every command and a recipe for adding one. Read it before touching `src/core/shell/`,
`src/core/commands/`, `src/core/scripting/`, `src/core/packages/` or `src/core/wordlist/`.

## The shape in one paragraph

A command is a plain object with an `execute(env, args, flags)` function. The shell (`runLine.ts`)
tokenizes the line, splits it into pipeline stages, looks each stage up in the **registry**, binds
its flags, validates every stage before running any, then runs the stages, threading one stage's
stdout into the next and applying a trailing `>` or `>>`. **Whether a command exists on a machine is
decided by the filesystem**: the registry wraps each command in a check that its binary is present
in `/bin`, `/usr/bin` or `/usr/sbin` and its shared libraries are in `/lib`. Delete `/bin/ls` on a
box and `ls` is gone there.

## Key files

| Path                                                                 | What it does                                                                                                       |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `shell/tokenize.ts`                                                  | Line → tokens: words (with quoting), `\|`, `>`, `>>`.                                                              |
| `shell/pipeline.ts`                                                  | Tokens → stages split on `\|`, plus an optional trailing redirect.                                                 |
| `shell/bindFlags.ts`                                                 | A stage's args → positionals and flags, using the command's `FlagSpec`.                                            |
| `shell/runLine.ts`                                                   | `runCommandLine`: the orchestrator (gates, validation, pipes, redirects). Also `hasTty`, `collectStageOutput`.     |
| `shell/complete.ts`                                                  | Tab completion (commands, paths, flags, keyword arguments).                                                        |
| `shell/prompt.ts`, `commandHistory.ts`                               | Prompt strings and ↑/↓ history recall.                                                                             |
| `commands/types.ts`                                                  | **The contract**: `Command`, `CommandEnv`, `CommandResult`, `TerminalLine`, `ModeChange`, every sub-API interface. |
| `commands/registry.ts`                                               | `commandRegistry` and `carriedCommandRegistry`, built from one `builtins` array.                                   |
| `commands/availability.ts`                                           | The binary-presence gate; the list of always-available builtins and game commands.                                 |
| `commands/libraryDeps.ts`                                            | The shared-library gate and the command → library link map.                                                        |
| `commands/streaming.ts`                                              | `streamedResult`: turns an async generator into a streamed result that keeps its exit code.                        |
| `commands/help.ts`, `man.ts`                                         | Read registry metadata to list commands and show manual pages.                                                     |
| `commands/daemon.ts`                                                 | One factory behind every service daemon (`sshd`, `mysqld`, `redis-server`, `named`, `snmpd`, …).                   |
| `commands/ftpShell.ts`, `mysqlShell.ts`, `redisShell.ts`             | Line interpreters for the `ftp>`, `mysql>` and `redis>` sub-shells (not registered commands).                      |
| `commands/<name>.ts`                                                 | One file per command (the catalog below).                                                                          |
| `scripting/`                                                         | The `node` sandbox: `runScript`, `buildCommandContext`, the script `console` and `fs`.                             |
| `packages/aptPackages.ts`                                            | The `apt` catalog: what each package installs.                                                                     |
| `packages/dpkgStatus.ts`, `packageManifest.ts`, `packageVersions.ts` | The `/var/lib/dpkg/status` manifest and version templates.                                                         |
| `wordlist/defaultWordlist.ts`, `passwordSweep.ts`                    | The wordlist `hydra` ships, and the one rule that decides what a dictionary attack recovers.                       |

## The `Command` contract

```ts
type Command = {
  name: string; // the real binary name, hyphens allowed ('redis-cli', 'aircrack-ng')
  description: string;
  category: 'general' | 'filesystem' | 'mission' | 'network' | 'wifi'; // groups `help`
  tier: UserType; // documentation only
  availability: AvailabilityRule; // documentation only
  manual?: ManualPage; // `man` page; arguments[0].values feeds tab completion
  flags?: FlagSpec; // { '-p': 'string', '-a': 'boolean' } — keys are DASHED
  stacking?: boolean; // allow `-la` → `-l -a`
  bareNumberFlag?: string; // the string flag a bare `-5` binds to ('-n' on head/tail)
  withoutTty?: string | ((args, flags) => string | undefined); // refusal on a shell without a terminal
  withoutScript?: string | ((args, flags) => string | undefined); // refusal when called from a script
  execute: (
    env: CommandEnv,
    args: string[],
    flags: ReadonlyMap<string, string | true>,
  ) => Promise<CommandResult>;
};

type CommandResult =
  | { kind: 'sync'; lines: TerminalLine[]; exitCode: number }
  | { kind: 'async'; lines: AsyncIterable<TerminalLine>; exitCode: () => Promise<number> }
  | { kind: 'mode_change'; mode: ModeChange }; // open nano, lynx or the author card

type TerminalLine = { kind: 'text' | 'error' | 'dim' | 'prompt'; content: string };
```

Things that surprise newcomers:

- **`tier`, `availability` and `description` enforce nothing.** No production code reads `tier` or
  `availability`. Gating is entirely filesystem-driven (see below). Do not write tests asserting
  them.
- **Every command is `async`**, even `pwd` (rewrite decision D3). The `await` is free and it removes
  a sync/async split at call sites.
- **Only `text` lines are stdout.** `error`, `dim` and `prompt` go to the terminal and are never
  piped or redirected, the way stderr works in bash.
- **The streamed exit code is a function**, because `for await` throws away a generator's return
  value. Build streamed results with `streamedResult(generator)`, which captures it.
- **A streamed command is lazy.** `await command.execute(...)` runs nothing until the lines are
  consumed. Tests must drain the stream before asserting side effects.

The command receives everything it may touch in `env` (chapter 4). It must never import `ui/` or
`adapters/`.

## From line to output: `runCommandLine`

1. **Gates, before parsing.** If the active session is a backdoor whose listener has gone, the
   session is popped and the shell prints `nc: connection closed by foreign host`. If the box has
   rebooted under this session (its boot id changed), the session is popped with `Connection to
<host> closed by remote host.`. Running these before the parse means a pipeline cannot slip past
   them.
2. **Tokenize.** An unterminated quote is `bash: syntax error: unexpected end of file` (exit 2).
3. **Parse the pipeline.** A misplaced `|` or `>` is a bash-style syntax error (exit 2).
4. **Validate every stage first.** For each stage: resolve the command, bind its flags, check the
   terminal rule. Any failure returns before anything runs, so a typo in stage three cannot leave
   stage one's side effects half-applied.
5. **Validate the redirect target** before running (bash opens redirects before executing).
6. **Run the stages.** Each stage after the first gets `env.stdin`, an async iterable over the
   previous stage's stdout. Intermediate stages are drained completely; their non-stdout lines are
   carried and shown before the final output, **but only when the final stage returns a `sync`
   result** (or the output is redirected). If the final stage streams, the carried lines are dropped
   (`withCarried` in `runLine.ts`).
7. **Finish.** With `>`, the final stdout is written with `env.patches.write`. With `>>`, the file
   is re-read from the machine (`env.fs.reload()`), the new text appended, and written back naming
   the old content as its base (so a concurrent edit is refused, not silently reverted), keeping the
   file's owner and permissions. The exit code is the **last** stage's (no `pipefail`).

### What the shell supports, exactly

| Supported                                                                    | Not supported                                                                          |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `"double"` and `'single'` quotes; adjacent segments join (`"x"y'z'` → `xyz`) | `\` escapes                                                                            |
| `""` as an explicit empty argument                                           | `$VAR`, `~`, globbing (`*`, `?`), command substitution                                 |
| Pipes `a \| b \| c`                                                          | `;` and `&&` (they become literal words); `\|\|` (a syntax error: an empty pipe stage) |
| Output redirect `>` and append `>>`, only at the end                         | Input redirect `<`                                                                     |
| Per-command flags; `--` ends option parsing                                  | `--flag=value` and glued `-pVALUE` forms                                               |

`find` does its own glob matching on its argument; that is the command, not the shell. Lines typed at
`ftp>`, `mysql>` and `redis>` bypass the shell entirely: `ftp>` splits them on whitespace, while
`mysql>` and `redis>` send the raw line to their statement parsers (SQL patterns for the database;
the store treats a double-quoted run as one token).

### Flag binding

`bindFlags` walks the arguments left to right:

- `-` alone is a positional (stdin shorthand); `--` makes every later token positional.
- A `'boolean'` flag becomes `true`. A `'string'` flag **always** consumes the next token as its value
  (`-n -5` binds `-5`); a missing value is `option requires an argument`. It also takes its value
  written onto it (`-n5`, `-p2222`), unless the whole token is itself a declared flag (`-sV`).
- A bare number (`-5`) binds to the command's `bareNumberFlag`, so `tail -5` is `tail -n 5`.
- With `stacking: true`, `-abc` expands to `-a -b -c` only if **every** letter is a declared boolean
  flag; otherwise the whole token is rejected.
- Any other dash token is `unrecognized option`.

Flag keys are **dashed** (`'-p'`, never `p`). Tests that hand-build a flag `Map` bypass `bindFlags`, so
test flag parsing through `runCommandLine`.

## Availability: the filesystem decides

`registry.ts` builds the registry from one `builtins` array. Each command except the always-available
ones is wrapped as `wrapWithBinaryCheck(wrapWithLibraryCheck(command))`:

1. **Binary check** (outermost): look for the command's binary in `/bin`, `/usr/bin`, `/usr/sbin`.
   Missing → `command not found` (exit 127), with an `apt install <package>` hint from the catalog.
   Present but the session's tier may not execute it → `Permission denied` (126).
2. **Library check**: every shared library the command links (`libraryDeps.ts`) must exist in
   `/lib`, or the command fails with a glibc-style loader error (127).

**Always available** (`availability.ts`): the shell builtins `cd`, `echo`, `exit`, `pwd`, `help`, and
the game commands `identity`, `new-game`, `theme`, `effects`, `author`, `xterm`. `clear` and `whoami` are **not**
builtins; they are real `/bin` binaries a player can delete.

A second registry, `carriedCommandRegistry`, serves binaries run by path (`/tmp/tool`). The tool is
identified by the binary's **content**, not its filename, so a renamed copy is still what it was.

`commandRegistry.get('curl')` is the gated wrapper, not the module's `curl` export. Tests assert
behaviour, never identity, and a test that goes through the registry must first install the binary
stub (`binaryStub(name)` in `generation/binaries.ts`).

### Terminal and script rules

- **No terminal (`withoutTty`).** A backdoor shell (`nc`) and a limited exploit shell have no
  terminal. Commands that need one (masked password prompts, full-screen apps) declare `withoutTty`
  with their refusal message. The function form refuses only some forms (for example `gpg` with the
  passphrase as an argument works without a terminal).
- **Not from scripts (`withoutScript`).** Commands that push or pop a session, open a screen, or enter
  a sub-shell refuse to run from a `node` script: `ssh`, `su`, `nc` (connect form), `exit`, `reboot`,
  `nano`, `lynx`, `mysql`, `redis-cli`, `ftp`, and the UI commands.

## Slow commands stream their progress

A command whose work takes real time (a server round-trip, or something slow in real life) returns a
streamed result and **announces each step before doing it**:

- a line ending in `...` means "happening now"; the arrival of the next line means it finished;
- there is **no** `Done` marker on the in-flight line (a terminal that only appends cannot rewrite
  it);
- steps are paced with `env.sleep(ms)`, which Ctrl-C interrupts;
- a refusal that never reached the slow work (not root, offline) stays a `sync` result with no
  preamble.

## Sub-shells

`ftp>`, `mysql>` and `redis>` are restricted command maps, not hops or screens. The UI sends the line
to `runFtpLine`, `runMysqlLine` or `runRedisLine` instead of the registry, so an outer command like
`cat` can never reach your own box while you think you are addressing the remote one.

- `ftp>`: `get`, `put`, `ls`, `cd`, `pwd` on the remote; `lls`, `lcd`, `lpwd` locally; `help`,
  `quit`, `bye`.
- `mysql>`: SQL statements, run on the server (or locally on your own box).
- `redis>`: store commands, run on the server (or locally on your own box).

## Scripting: the `node` command

`node <script.js> [args]` runs a player's JavaScript file in a sandbox where **every registered
command is an awaitable function**. The design rule: scripting removes typing, it grants no
capability. A script runs at the same tier, through the same checks, with the same refusals as typing.

- `runScript(source, context)` builds an `AsyncFunction(...contextNames, "{\n" + source + "\n}")` and
  awaits it. Wrapping the source in a block lets a script declare its own `const console`.
- `buildCommandContext` turns each command into a function named by `scriptIdentifier`, which
  camelCases hyphenated names (`redis-cli` → `redisCli`). A hyphen in a parameter name would be a
  syntax error in every script; the legacy app had exactly that bug. `registry.test.ts` checks every
  name maps to a valid, unique identifier.
- A call returns the command's stdout as an array of lines with an extra `exitCode` property. A
  trailing plain object is the flags map (`await nmap('10.0.0.1', {'-sV': true})`). Non-stdout lines
  are printed to the terminal.
- Four names are injected **last** so no command can shadow them: `console`, `fs` (`readFile`,
  `writeFile`, `appendFile`; `readFile` and `appendFile` read the live machine through
  `env.fs.reload()`, while `writeFile` resolves its target against the command's snapshot), `process`
  (`argv`) and `sleep`.
- Ctrl-C is checked before and after every command call. A synchronous infinite loop cannot be
  interrupted (an accepted limitation); `sleep` is the yield point.
- `msfconsole` reuses the same host for its "run a script on a target" effect, with a restricted,
  `fs`-only context.

## Packages: `apt`

`apt install | list | upgrade` manages what a box carries.

- **The catalog** (`packages/aptPackages.ts`) says what each package is: its binaries (tools go to
  `/usr/bin`, daemons to `/usr/sbin`), dependencies (one level), and extra data files computed per
  box.
- **`install`** checks root, then network, then the package, before writing anything. It writes the
  binary stubs, missing libraries and data files (never overwriting an existing file, so a curated
  wordlist survives a reinstall), and records the version in `/var/lib/dpkg/status`.
  `install pkg=<version>` pins an older release.
- **`list -u`** reads the box's manifest and names each package with a live vulnerability, its
  severity and whether a fix exists (chapter 8). `list` needs no root.
- **`upgrade`** moves packages onto their fixing release. Like `install`, it needs root and a
  network.
- `/var/lib/dpkg/status` is **the** version authority. Scans, the vulnerability system and `apt` all
  read it.
- `core/packages/` imports nothing from `core/commands/`; the world generator uses the catalog to
  decide what a generated box carries (`binariesForService`).

## The wordlist

`apt install hydra` ships `/usr/share/wordlists/passwords.txt`. `sweepAccounts` in
`wordlist/passwordSweep.ts` is the single cracking rule shared by every `hydra` path: an account's
hash falls if and only if the MD5 of some word **in the file on the box** equals it. The file is the
difficulty curve: players can grow it by hand, and `hydra` and `john` read the file on the box, never
the built-in constant. (`gobuster` works the same way with its own path list,
`/usr/share/wordlists/dirlist.txt`, installed by `apt install gobuster`.) How many words were
tried before the match is what the defender's log records. `aircrack-ng` is different: whether a
WiFi password falls is a generated property of the network, and its wordlist output is only
animation.

## Command catalog

Result: **S** sync, **A** streamed, **M** opens a full-screen app. As of v0.278.0 there are 65
registered commands; `registry.ts` is the source of truth.

### General

| Command    | What the player does                                          | Result |
| ---------- | ------------------------------------------------------------- | ------ |
| `help`     | List all commands by category                                 | S      |
| `man`      | Show a command's manual page                                  | S      |
| `echo`     | Print its arguments                                           | S      |
| `clear`    | Clear the screen (a real `/bin` binary, so it can be deleted) | S      |
| `exit`     | Leave the current hop (no-op at the base login)               | S      |
| `su`       | Switch user (default root), masked password prompt            | S      |
| `identity` | Show the player's public key and fingerprint                  | S      |
| `theme`    | List or switch colour themes                                  | S      |
| `effects`  | List or switch the neon effects (glow, glitch, HUD, cursor)   | S      |
| `author`   | Show the author card                                          | M      |
| `xterm`    | Open a second terminal (new tab) on your own box              | S      |
| `new-game` | Wipe progress and restart, after confirmation (`-y`)          | S      |

### Filesystem

| Command        | What the player does                                        | Result |
| -------------- | ----------------------------------------------------------- | ------ |
| `ls`           | List a directory (`-a`, `-l`, stackable)                    | S      |
| `cat`          | Print files or stdin (`-n`)                                 | S      |
| `cd`, `pwd`    | Change and print the working directory                      | S      |
| `find`         | Find entries by name glob                                   | S      |
| `grep`         | Search files or stdin, case-insensitive (`-l`, `-c`)        | S      |
| `head`, `tail` | First or last N lines (`-n N`, `-nN`, `-N`)                 | S      |
| `wc`           | Count lines and words (`-l`, `-w`)                          | S      |
| `strings`      | Print readable runs inside a file                           | S      |
| `mkdir`        | Create directories (`-p`)                                   | S      |
| `touch`        | Create empty files                                          | S      |
| `rm`           | Remove files and directories (`-r`, `-f`)                   | S      |
| `chmod`        | Change tier permissions (symbolic modes)                    | S      |
| `nano`         | Edit a file full-screen                                     | M      |
| `gpg`          | Encrypt (`-c`) or decrypt (`-d`) a file with a passphrase   | S      |
| `ldd`          | Show the libraries a binary links                           | S      |
| `john`         | Crack hashes in a file against the wordlist (leaves no log) | A      |
| `node`         | Run a JavaScript file in the sandbox                        | A      |
| `reboot`       | Reboot the current machine (root)                           | A      |
| `whoami`       | Print the active username                                   | S      |

### Network

| Command                                                                 | What the player does                                                               | Result |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------ |
| `nmap`                                                                  | Scan a host or range; `-sV` adds versions and known vulnerabilities                | A      |
| `ping`                                                                  | Check reachability                                                                 | A      |
| `nslookup`, `dig`                                                       | Resolve names; `dig @server axfr` attempts a zone transfer                         | S      |
| `whois`                                                                 | Look up the network, organisation, town and region behind an address or a domain   | S      |
| `curl`                                                                  | Fetch a URL (`-i` for headers)                                                     | A      |
| `lynx`                                                                  | Browse a page full-screen                                                          | M      |
| `gobuster`                                                              | Probe a web server for paths from a list                                           | A      |
| `nc`                                                                    | Connect to a port and read its banner; `-l` plants a listener (root)               | A/S    |
| `ssh`                                                                   | Log into a host (`user@host`, `-p port`); pushes a hop                             | S      |
| `scp`                                                                   | Copy a file to or from a host                                                      | A/S    |
| `ftp`                                                                   | Log into a host's FTP service; opens `ftp>`                                        | S      |
| `mysql`                                                                 | Open a database; opens `mysql>`                                                    | S      |
| `redis-cli`                                                             | Open a key-value store; opens `redis>`                                             | S      |
| `snmpwalk`, `snmpset`                                                   | Read or reconfigure a network device over SNMP                                     | S      |
| `hydra`                                                                 | Dictionary-attack a service's accounts (decided on the server, logged)             | A      |
| `msfconsole`                                                            | Fire a published vulnerability at a host and port; `--local <command>` on your box | A/S    |
| `apt`                                                                   | Install and upgrade packages (root, online), or list them (any tier)               | A/S    |
| `kill`                                                                  | Remove a planted listener by PID                                                   | S      |
| `systemctl`                                                             | `start`, `stop`, `status`, `restart` a service                                     | S/A    |
| `ps`                                                                    | List running services and listeners                                                | S      |
| `ifconfig`                                                              | Show network interfaces (`-a`)                                                     | S      |
| `sshd`, `vsftpd`, `nginx`, `apache2`, `mysqld`, `redis-server`, `named` | Start a service daemon (root)                                                      | A/S    |
| `snmpd`                                                                 | Start the SNMP agent once `apt install snmp` has laid it down (root)               | A/S    |

### WiFi

| Command       | What the player does                                                         | Result |
| ------------- | ---------------------------------------------------------------------------- | ------ |
| `airmon-ng`   | Toggle monitor mode on `wlan0`                                               | S      |
| `airodump-ng` | Scan for nearby access points                                                | A/S    |
| `aircrack-ng` | Recover the WiFi password of a scanned network (if the network is crackable) | A/S    |
| `nmcli`       | `connect`, `disconnect`, `status` a WiFi network                             | A/S    |

## Rules you must not break

1. **Command names are the real binary's name, hyphens included**; the module and export use the
   camelCase form (`redisCli.ts` exports `redisCli`).
2. **Flag keys are dashed.**
3. **Port a legacy command faithfully.** When porting from the legacy app (git tag `legacy-final`),
   read its `src/commands/` first and keep its flags, behaviours and error shapes. Adding or dropping
   flags needs the owner's agreement.
4. **Validate every stage before running any.**
5. **Only `executeLine` prints `^C`.** Commands throw on abort.
6. **Availability comes from the filesystem**, never from metadata.
7. **Scripts get no capability that typing does not.**
8. **Slow work streams, announcing each step before it happens.**

## How to add a command

1. **Create `src/core/commands/<camelName>.ts`** exporting `const <camelName>: Command`, with `name`
   set to the real binary name. Fill `description`, `category`, `tier`, `availability`, `manual`
   (synopsis, description, arguments, examples), `flags` with dashed keys, and `stacking` if it has
   stackable one-letter boolean flags.
2. **Register it** in `commands/registry.ts`: add the import and add it to `builtins`. The map key is
   derived from `name`.
3. **Decide how it becomes available:**
   - pre-installed on every box → add it to `SYSTEM_UTILITY_NAMES` or `SYSTEM_DAEMON_NAMES` in
     `generation/binaries.ts`;
   - installable → add an `AptPackage` to `packages/aptPackages.ts`;
   - it links libraries → add it to `commands/libraryDeps.ts`;
   - a game command with no binary → add it to `GAME_COMMANDS` in `commands/availability.ts`.
4. **Add `withoutTty` / `withoutScript`** if it prompts for a secret, opens a screen, pushes or pops a
   session, or enters a sub-shell.
5. **Write `execute`.** Return `sync` for instant work, `streamedResult(...)` for slow work, or a
   `mode_change` for a full-screen app. Read only from `env`.
6. **If it needs something new from the outside world**, add a `CommandEnv` seam (chapter 4) and, if
   it talks to the server, an API action (chapter 10).
7. **Test it** in `src/core/commands/<camelName>.test.ts`: build a tree with the filesystem
   factories, build `mockCommandEnv({...})`, call `execute`, drain streamed results, and assert on
   lines, exit code and the seams it called. Test flag parsing through `runCommandLine`. Do not
   assert metadata literals.
8. **Bump the version** in `package.json` and `package-lock.json` (`npm install --package-lock-only`).

## Pitfalls

- **An interrupted redirect is silent**: Ctrl-C during `cmd > file` prints no `^C` and writes no
  partial file.
- **Error lines from an early pipeline stage are dropped when the last stage streams.**
  `withCarried` in `runLine.ts` prepends carried lines only to a `sync` final result; that other
  branch is untested (a surviving mutant there would throw by spreading an async iterable).
- **`env.fs` is a snapshot.** Read-modify-write must use `env.fs.reload()`.
- **`patches.write` stamps the session's user as owner and the tier's default permissions** unless
  the caller passes `owner` and `permissions`. Right for "this is mine" writers, wrong for editing
  someone else's file.
- **A command keeps running after its last line paints** (the UI awaits the exit code). UI tests must
  wait for the prompt to return.
- **Which tools survive a library wipe is uneven**: many file tools link one shared library and break
  together; `head`, `tail`, `wc`, `echo`, `pwd` link none.

## Where it is tested

Every command has a colocated test. The shell's integration hub is `shell/runLine.test.ts`; the parser
has `tokenize.test.ts`, `pipeline.test.ts` and `bindFlags.test.ts`; `registry.test.ts` checks names,
categories and script identifiers; `scripting/commandContext.test.ts` and `commands/node.test.ts`
cover the sandbox. There is no shared "drain a streamed result" helper; tests define their own, and
`collectStageOutput` from `shell/runLine.ts` can serve as one.
