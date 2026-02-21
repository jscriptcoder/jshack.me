# Learnings: JSHACK.ME CTF Terminal Game

## Gotchas

### Empty async output lines collapse

- **Context**: When streaming async command output with `onLine('')`
- **Issue**: Empty string content causes `<div>` to collapse, hiding the line break
- **Solution**: Render non-breaking space `'\u00A0'` for empty content in TerminalOutput

### AsyncOutput needs follow-up actions for multi-phase commands

- **Context**: SSH needs to show connection progress, then prompt for password
- **Issue**: Original AsyncOutput only had `onComplete()` with no return value
- **Solution**: Extended `onComplete(followUp?: SshPromptData)` to support triggering password mode after async phase

### Password validation differs between local and remote

- **Context**: `su` validates against /etc/passwd, `ssh` validates against remote machine users
- **Issue**: Single `validatePassword` function needed to handle both cases
- **Solution**: Check `sshTargetIP` state to determine which validation path to use

### FTP requires dual-filesystem access

- **Context**: FTP `get`/`put` commands need to read from one machine and write to another simultaneously
- **Issue**: Original FileSystemContext only tracked one active filesystem via `switchMachine()`
- **Solution**: Track all machine filesystems in state, add cross-machine methods like `readFileFromMachine()`, `writeFileToMachine()`

### Session stack needed for SSH return

- **Context**: After `ssh` into a remote machine, user needs to return with `exit()`
- **Issue**: Session state was overwritten on SSH, no way to restore previous state
- **Solution**: Add `sessionStack` to SessionContext with `pushSession()`/`popSession()` methods

### Combined prompt modes simplify TerminalInput

- **Context**: Password input hides prompt and masks input; FTP username input hides prompt but shows text
- **Issue**: Had separate `passwordMode` and `hidePrompt` props with overlapping behavior
- **Solution**: Single `promptMode?: 'username' | 'password'` prop - both hide prompt and disable history/tab, only password masks

### Type assertions hide bugs

- **Context**: Using `result as AuthorData` to tell TypeScript the type
- **Issue**: Assertions bypass type checking; if result isn't actually AuthorData, runtime error
- **Solution**: Use type guards that verify the structure: `if (isAuthorData(result)) { ... }`

### Readonly arrays need explicit parameter types

- **Context**: Passing `readonly string[]` to a function expecting `string[]`
- **Issue**: TypeScript error "readonly cannot be assigned to mutable type"
- **Solution**: Update function parameters to accept `readonly string[]`

### Hardcoded values in command implementations

- **Context**: nc command had hardcoded `/home/ghost` path and "ghost" user
- **Issue**: When adding a second backdoor (webserver port 4444 as www-data), the hardcoded values broke
- **Solution**: Use dynamic context from configuration (e.g., `port.owner`) instead of hardcoding values

### Function signature mismatches in injected context

- **Context**: nc subcommands received `resolvePath` function via context injection
- **Issue**: Commands called `resolvePath(machineId, path, cwd)` but function signature was `(path, cwd)` - machineId was already captured in closure
- **Solution**: Match function signatures exactly; rename context properties to avoid confusion (e.g., `resolvePathForMachine` → `resolvePath`)

### Unnecessary feature complexity

- **Context**: nc cd command had `~` home directory shortcut handling
- **Issue**: Required dynamic home path lookup, added complexity for a feature nobody requested
- **Solution**: Remove the feature entirely - simpler is better when the feature isn't needed

### DNS resolution order matters

- **Context**: nc command checks if target is localhost
- **Issue**: Test expected "Connection refused" for localhost but got "Name or service not known" because DNS resolution runs first
- **Solution**: Tests should match actual execution order; DNS lookup → localhost check → connection

### Top-level await not supported in new Function()

- **Context**: Terminal uses `new Function()` to evaluate JavaScript expressions
- **Issue**: Users can't use `await` directly: `const log = await output(ping("host"))` fails
- **Solution**: Provide `resolve()` command to unwrap Promises; users learn about Promises organically

### Dotfile filtering is the command's responsibility, not the filesystem's

- **Context**: FTP `ls`/`lls` and NC `ls` showed dotfiles while regular `ls` hid them
- **Issue**: `listDirectoryFromMachine()` returns ALL `Object.keys(node.children)` including dotfiles — it doesn't filter
- **Solution**: Each `ls` variant must filter dotfiles itself: `entries.filter(name => showAll || !name.startsWith('.'))`
- **Key insight**: When adding a new ls-like command, always add dotfile filtering — the filesystem layer won't do it for you

### `getMachine()` only searches reachable machines, not self

- **Context**: `su` command calls `getUsers()` to validate the target user exists on the current machine
- **Issue**: `getUsers()` used `getMachine(session.machine)`, but `getMachine()` searches `currentConfig.machines` — the machines reachable FROM the current machine. A machine doesn't list itself as reachable, so `getMachine()` returns `undefined` → empty user array → "user does not exist" error
- **Solution**: Search across ALL `config.machineConfigs` values to find the `RemoteMachine` entry matching `session.machine`, instead of using `getMachine()` which only searches the current machine's reachable list
- **Key insight**: `getMachine(ip)` answers "can I reach this IP from here?" — not "give me info about the machine I'm currently on"

### Filesystem factory `extraDirectories` replaces entire branches

- **Context**: `createFileSystem(config)` uses `extraDirectories` keys as top-level directory names
- **Issue**: Setting `var: { ... }` in `extraDirectories` replaces ALL of `/var`, not just what you specify — factory defaults for `/var/log` etc. are lost
- **Solution**: When using `extraDirectories`, include everything you want under that branch (e.g., both `/var/www` and `/var/log` content)
- **Applied**: Target file templates use `/srv/` and `/opt/` prefixes instead of `/var/www/`, `/var/lib/`, or `/home/` to avoid conflicting with factory-managed directories

### curl GET vs POST resolve to different filesystem paths

- **Context**: curl simulates web servers by reading files from the remote machine's filesystem
- **Issue**: GET and POST have completely different path resolution — easy to add content in the wrong place
- **Solution**: GET reads `/var/www/html${urlPath}`, POST reads `/var/www/api/${endpoint}.json` — content must exist at the right path for the HTTP method

### `getUsers()` only searched static config, not mission network config

- **Context**: `su("root")` on a mission-generated machine (e.g., `10.100.103.11`)
- **Issue**: `getUsers()` in `useCommands.ts` searched `config.machineConfigs` (static) to find the RemoteMachine entry matching `session.machine`. Mission machine IPs don't exist in static config → empty user array → "user does not exist" error
- **Solution**: Added `findMachineUsers(ip)` to `NetworkContext` that searches both static `config` and `missionNetworkConfig`. `useCommands.ts` calls this instead of manually searching configs.
- **Key insight**: Any code that looks up machine metadata by IP must search both static and mission configs. Centralize these lookups in `NetworkContext` rather than having each consumer search independently.

### Path autocomplete resolves against the wrong machine in modal modes

- **Context**: NC mode runs commands on a remote machine, but `usePathAutoComplete` was initialized with the main session's `listDirectory`/`getNode`/`resolvePath` (which use `currentMachine` from the main session)
- **Issue**: Typing `cat('ind` + Tab in NC mode autocompleted against localhost's filesystem, not the NC target machine. Same issue exists for FTP remote commands.
- **Solution (NC)**: Create `useCallback` wrappers in `Terminal.tsx` that bind the NC session's `targetIP` and `currentPath` into the machine-specific APIs (`listDirectoryFromMachine`, `getNodeFromMachine`, `resolvePathForMachine`), matching the simpler signatures `usePathAutoComplete` expects. Swap these in when NC mode is active.
- **FTP limitation**: FTP is harder because it has two machines simultaneously. Dual-argument commands like `get(remote, local)` need per-argument context based on cursor position. Remote commands (`cd`, `ls`) autocomplete against the origin machine (wrong), while local commands (`lcd`, `lls`) happen to work.
- **Key insight**: Any hook initialized with session-derived context (machine, cwd, userType) needs to be re-initialized or adapted when a modal mode changes the effective context. The main session state doesn't change when entering NC/FTP mode — only the modal session state does.

### Adding PRNG consumers shifts downstream deterministic output

- **Context**: Added `selectTargetFile()` (calls `prng.pick()`) inside `generateAttackChain()` before the attack chain loop
- **Issue**: The shared PRNG stream is consumed sequentially. Adding new picks before existing ones shifts all downstream outputs — attack chain credential selections, placement templates, etc. produce different results for the same seed.
- **Solution**: Accept that E2E test data must be rediscovered when the generation pipeline changes. Use a temporary discovery script to trace the new attack chain, credential placements, and target paths for known seeds.
- **Key insight**: In a deterministic PRNG pipeline, any new `prng.pick()`/`prng.nextInt()` call changes ALL subsequent values. This is by design — seeds are stable within a code version, not across versions.

### Mission complete banner uses 'banner' type, not 'result'

- **Context**: E2E test waiting for "MISSION COMPLETE" text after capturing a flag
- **Issue**: `page.locator(RESULT, { hasText: 'MISSION COMPLETE' })` never matched because `Terminal.tsx` renders mission complete via `addLine('banner', ...)`, which uses the `terminal-banner` data-testid, not `terminal-result`
- **Solution**: Use `page.locator(BANNER, { hasText: 'MISSION COMPLETE' })` in E2E tests
- **Key insight**: Different output types (`banner` vs `result` vs `error`) have different `data-testid` selectors. Check Terminal.tsx's `addLine` calls to know which selector to use in E2E tests.

### `getMachine()` returns undefined for current machine in `handlePasswordSubmit`

- **Context**: `su("admin")` on gateway sets admin as 'user' instead of 'root'
- **Issue**: `Terminal.tsx`'s `handlePasswordSubmit` used `getMachine(session.machine)` to look up user types. But `getMachine()` only searches machines reachable FROM the current machine — a machine doesn't list itself. Returns `undefined`, falls back to name-based guessing which gives "admin" the wrong type.
- **Solution**: Added fallback in `handlePasswordSubmit` that searches `Object.values(networkConfig.machineConfigs).flatMap(mc => mc.machines)` — same pattern already used in `getUsers()` in `useCommands.ts`
- **Key insight**: Two separate su user-type lookups existed (one in `useCommands.ts` for `getUsers()`, one in `Terminal.tsx` for `handlePasswordSubmit`). Both needed the same all-configs-search fallback.

### `btoa` rejects characters above Latin-1 after XOR

- **Context**: XOR cipher on string characters, then `btoa()` to Base64
- **Issue**: XOR of two Unicode characters can produce code points > 255. `btoa()` only accepts Latin-1 (0-255) and throws `InvalidCharacterError` for anything above.
- **Solution**: Work at the byte level instead — `TextEncoder.encode()` to get UTF-8 bytes, XOR the bytes with key bytes, then Base64-encode the resulting byte array. Decode in reverse: Base64 → bytes → XOR → `TextDecoder.decode()`.
- **Key insight**: String-level XOR is unreliable for Base64 encoding. Always convert to bytes first when doing bitwise operations on text.

### Playwright E2E stale DOM matching

- **Context**: Waiting for text like "Password:" after a command in a terminal that accumulates output
- **Issue**: `page.locator(RESULT, { hasText: 'Password:' }).first().waitFor()` immediately matches stale output from earlier commands (e.g., a previous `su` prompt)
- **Solution**: `countThenWait` pattern — count matching elements BEFORE the action, then wait for `locator.nth(beforeCount)` (the new match). Also use specific text patterns (regex `/^Password:$/` for su vs `${user}@${host}'s password:` for SSH) to avoid cross-matching.

### WiFi gating needs to NOT gate ifconfig

- **Context**: WiFi hacking gate blocks network commands until player cracks WiFi
- **Issue**: If `ifconfig()` is also gated, the player has no way to discover that `wlan0` is DOWN
- **Solution**: Wrap only network commands (ping, nmap, ssh, ftp, nc, curl, nslookup) with the WiFi check; `ifconfig()` is explicitly excluded so the player can see the disconnected interface

### NetworkContext getLocalIP/getGateway assumed eth0

- **Context**: Changing localhost's interface from `eth0` to `wlan0`
- **Issue**: `getLocalIP()` and `getGateway()` had hardcoded `find(iface => iface.name === 'eth0')`, so they returned `'0.0.0.0'` after renaming to `wlan0`
- **Solution**: Changed to find the first non-loopback UP interface instead of searching by name: `interfaces.find(iface => iface.name !== 'lo' && iface.flags.includes('UP'))`
- **Key insight**: When interface names are dynamic or vary by machine, search by role (non-loopback, UP) rather than by hardcoded name

### Command gating via wrapper function

- **Context**: Network commands need to check WiFi connectivity before executing
- **Issue**: Could either modify each command factory to accept WiFi state, or wrap at the hook level
- **Solution**: Created `wrapWithWifiCheck(cmd, isWifiRequired)` that returns a new Command with the same metadata but a wrapped `fn` that checks WiFi first. Applied in `useNetworkCommands` — zero changes to individual command files
- **Key insight**: The wrapper pattern preserves command metadata (name, description, manual) while adding cross-cutting behavior. Same pattern as `applyCommandRestrictions` for permission gating.

### Transient vs persisted state for WiFi flow

- **Context**: WiFi cracking has two pieces of state: monitor mode and WiFi connected
- **Issue**: Monitor mode is a temporary tool state (like having a program running), while WiFi connected is a persistent achievement
- **Solution**: Monitor mode uses `useRef` (transient, resets on page refresh — player must re-enable before scanning), WiFi connected uses `session.wifiConnected` (persisted to IndexedDB — stays connected across refreshes)
- **Key insight**: Match state persistence to its nature — tool state is transient, progress state is persisted

### Auto-scroll misses layout changes when async command completes

- **Context**: Terminal hides the input prompt during async commands (`asyncRunning` state), showing it again on completion
- **Issue**: Auto-scroll `useEffect` only depended on `lines`. When async finishes, `setAsyncRunning(false)` re-renders the input — which takes up space at the bottom — but no new lines are added, so the scroll effect doesn't fire. The last few output lines get pushed above the viewport.
- **Solution**: Add `asyncRunning` to the scroll effect's dependency array: `useEffect(() => { ... }, [lines, asyncRunning])`. Now scroll-to-bottom also triggers when the input reappears.
- **Key insight**: Any layout change that affects the scroll container's visible area (adding/removing fixed-size elements like the input prompt) should be a dependency of the auto-scroll effect, not just content changes.

### Backwards compatibility for new session fields

- **Context**: Adding `wifiConnected` to Session type breaks persisted data from existing users
- **Issue**: Old IndexedDB data lacks `wifiConnected` field, causing validation to fail or TypeScript errors
- **Solution**: `isValidSession` accepts missing `wifiConnected` (undefined), `normalizeSession` defaults it to `false`. Same pattern already used for `ncSession`.
- **Key insight**: Every new persisted field needs: (1) validation that accepts undefined, (2) normalization to default value in `getInitialState`

### Custom cursor removal breaks E2E readiness detection

- **Context**: Replaced custom animated block cursor (`span.animate-pulse`) with native browser caret (`caret-amber-400`)
- **Issue**: E2E `waitForReady` relied on `span.animate-pulse` to detect terminal readiness after async operations. The custom cursor was only rendered when `isFocused && !disabled`, so it naturally disappeared during async output and reappeared when done. The native input is always in the DOM, so `waitForReady` returned immediately before async operations completed.
- **Solution**: Added `disabled` HTML attribute to the input (previously only checked in JS handlers). Updated `waitForReady` to use `:not([disabled])` selector. Also needed to refocus the input when `disabled` transitions to `false`, since browsers blur disabled inputs.
- **Additional breakage**: Unit tests queried for rendered text content (`getByText`) and `.animate-pulse` elements. Updated to query input values (`toHaveValue`) and `type="password"` attribute. Password prompt tests switched from `getByRole('textbox')` (doesn't match `type="password"`) to `container.querySelector('input')`.
- **Key insight**: When a custom UI element doubles as a state indicator for tests, check all test selectors that depend on its conditional rendering — especially E2E readiness checks that use presence/absence as a proxy for "the app is ready for input"

### Tests break when production code imports encoded files

- **Context**: Moved mission passwords from hardcoded array in `pools.ts` to `secrets/__encoded.ts`
- **Issue**: Tests importing `pools.ts` (directly or transitively via `users.ts`) now fail if `__encoded.ts` doesn't exist, because `pools.ts` imports from it at module level
- **Solution**: Add `pretest`, `pretest:run`, `pretest:coverage` npm hooks that run `npm run encode` — same pattern as existing `predev`/`prebuild` hooks
- **Key insight**: Any time production code imports from a generated file, ALL entry points that load that code need a pre-hook to ensure the file exists. The encode script is fast (~100ms) so the overhead is negligible.

### ESLint underscore-prefixed unused params flagged as errors

- **Context**: Test mocks need positional parameters to match function signatures, but don't use all of them (e.g., `_cwd`, `_userType` in `readFileFromMachine` mocks)
- **Issue**: Default `@typescript-eslint/no-unused-vars` rule doesn't allow `_prefixed` params — only bare `_` is ignored, but `_name` variants are still flagged
- **Solution**: Configure the rule with `argsIgnorePattern: '^_'` and `varsIgnorePattern: '^_'` in `eslint.config.js`. This is the standard convention across the TypeScript ecosystem.
- **Key insight**: Always configure this rule upfront in new projects to avoid accumulating suppression comments or `eslint-disable` directives

### react-refresh warns when context files export hooks alongside providers

- **Context**: Context files (e.g., `SessionContext.tsx`) export both a Provider component and a `useX` hook
- **Issue**: `react-refresh/only-export-components` warns that non-component exports break Fast Refresh
- **Solution**: Use `allowExportNames` option to whitelist specific hook and validator exports (e.g., `useSession`, `isValidPatch`). Note: only exact string matches are supported — no regex/glob patterns.
- **Alternative**: Move hooks to separate files, but co-locating Provider + hook is a well-established React pattern

### Static CTF removal requires broad reference cleanup

- **Context**: Removing 7 static machines (gateway through abyss) and their 16 flags to make the game mission-only
- **Issue**: Static machine references were embedded everywhere — command help examples, curl server configs, localhost filesystem hints, auth.log credential leaks, network configs, DNS records, encode script imports, test mocks
- **Solution**: Systematic search for machine names, IPs, and hostnames across the codebase. Most test mocks using static IPs as arbitrary test data didn't need changing (they're self-contained). Real issues were: (1) curl `SERVER_CONFIGS` with hardcoded per-machine headers, (2) command `examples` arrays, (3) localhost filesystem content pointing to deleted machines, (4) initialNetwork.ts machine/DNS configs.
- **Key insight**: When removing game content, the blast radius extends beyond the content files themselves. Command examples, tests, and filesystem hints all reference specific machines/IPs. A thorough grep for IPs and hostnames is essential.

## Patterns That Worked

### Command factory pattern with context injection

- **What**: Commands are created via factory functions that receive context (hooks, state)
- **Why it works**: Keeps commands pure and testable, dependencies injected at creation
- **Example**: `createSshCommand({ getMachine, getLocalIP })`

### Special `__type` property for custom rendering

- **What**: Command results with `__type` get special handling in Terminal
- **Why it works**: Clean separation between command logic and UI rendering
- **Example**: `{ __type: 'async', start: ... }`, `{ __type: 'password_prompt', ... }`

### Async streaming with cancellation support

- **What**: AsyncOutput interface with `start(onLine, onComplete)` and optional `cancel()`
- **Why it works**: Simulates realistic delays, supports interruption, keeps Terminal in control
- **Example**: ping, nmap, nslookup, ssh, ftp, curl all use this pattern

### Dual-filesystem access for FTP

- **What**: FileSystemContext stores all machine filesystems in state, provides cross-machine operations
- **Why it works**: FTP can read/write between origin and remote machines without switching active filesystem
- **Example**: `readFileFromMachine(machineId, path, cwd, userType)`, `createFileOnMachine(...)`

### Session stack for connection management

- **What**: SessionContext maintains a stack of session snapshots, pushed on SSH, popped on exit
- **Why it works**: Supports nested connections (SSH into machine A, then SSH into B), clean return path
- **Example**: `pushSession(currentPath)` before SSH, `popSession()` on exit restores full state

### FTP mode with dedicated command set

- **What**: `FtpSession` state tracks origin/remote machines, Terminal switches to FTP commands when active
- **Why it works**: Clean separation between normal and FTP modes, prompt changes to `ftp>`, limited command set
- **Example**: `useFtpCommands()` hook returns FTP-specific commands when `ftpSession` is active

### Immutable file system updates with recursive helpers

- **What**: Pure functions `updateNodeAtPath()` and `addChildAtPath()` for immutable tree updates
- **Why it works**: Avoids deep cloning with JSON.parse/stringify, proper immutable updates
- **Example**: `setFileSystem(prev => updateNodeAtPath(prev, parts, node => ({ ...node, content })))`

### Dynamic service ownership via configuration

- **What**: Port configuration includes optional `owner` field with username, userType, homePath
- **Why it works**: Services (like nc backdoors) can run as different users without hardcoding in command logic
- **Example**: `{ port: 4444, service: 'elite', open: true, owner: { username: 'www-data', userType: 'user', homePath: '/var/www' } }`

### Web Crypto API for encryption puzzles

- **What**: Use `crypto.subtle.encrypt/decrypt` with AES-256-GCM for CTF encryption challenges
- **Why it works**: Browser-native, secure algorithm, async API fits AsyncOutput pattern
- **Example**: `decrypt("secret.enc", "64-char-hex-key")` decrypts base64-encoded ciphertext

### IndexedDB persistence with pre-load cache

- **What**: Save session state and filesystem patches to IndexedDB, pre-load into a module-level cache before React mounts
- **Why it works**: Player progress survives page refresh; pre-load avoids loading states or UI flashes; IndexedDB has no 5MB limit; validates data with type guards before restoring
- **Example**: `await initializeStorage()` in `main.tsx` before `createRoot().render()`; contexts read from `getCachedSessionState()` synchronously
- **Key insight**: The async-to-sync bridge (pre-load cache) is the cleanest pattern for using async storage with React's synchronous `useState` initializers. The data is tiny (sub-5ms reads), so the startup delay is imperceptible.

### Filesystem persistence via patches

- **What**: Store only user-created/modified files as patches in IndexedDB, replay on top of base filesystem at init
- **Why it works**: Small storage footprint, base filesystem updates in code still take effect, clean "factory reset" by clearing the database
- **Example**: `applyPatches(baseFileSystems, getCachedFilesystemPatches())` at init; `upsertPatch(patches, { machineId, path, content, owner })` on write
- **Key insight**: Persisting the diff instead of the full tree avoids stale data problems and keeps storage usage minimal

### localStorage to IndexedDB migration

- **What**: One-time auto-migration from localStorage to IndexedDB for returning users
- **Why it works**: Idempotent (checks IndexedDB first), removes localStorage keys after successful migration, graceful fallback if IndexedDB unavailable
- **Key insight**: Migration in the pre-load phase (before React mounts) means the app never sees a mixed state

### Command restriction wrapping over removal

- **What**: Instead of removing restricted commands from executionContext (causing "X is not defined" JS errors), wrap their `fn` with a permission-checking function
- **Why it works**: Clear "permission denied" error instead of confusing JS error; `man()` can still look up restricted commands; command metadata preserved for help text
- **Example**: Guest calls `nmap()` → `Error: permission denied: 'nmap' requires user privileges`
- **Key insight**: Filtering `commandNames` (for autocomplete) and `help()` happens separately from wrapping execution context

### Prettier + ESLint separation of concerns

- **What**: Prettier handles formatting (indentation, quotes, semicolons, line width), ESLint handles code quality (unused vars, type safety, React hooks rules)
- **Why it works**: Each tool does what it's best at. `eslint-config-prettier` disables conflicting ESLint rules so they don't fight.
- **Key insight**: Configure Prettier to match existing code style first (single quotes, semicolons, trailing commas) to minimize diff when first formatting the codebase. Run `npm run format` once to align everything, then use `npm run format:check` in CI.

### Full-screen editor overlay via special output type

- **What**: `nano()` returns `{ __type: 'nano_open', filePath }`, Terminal.tsx detects it and renders `NanoEditor` as a fixed overlay
- **Why it works**: Extends the existing `__type` discriminated union pattern; editor is decoupled from command logic; overlay covers terminal without destroying its state
- **Example**: `nano("script.js")` → nano validates path → returns nano_open → Terminal reads file content → renders NanoEditor with save/create callbacks

### Unix-like execute permission for files

- **What**: `FilePermissions` has `execute` field alongside `read` and `write`. Only `node()` checks it; `cat`, `ls`, `cd` etc. only check read/write.
- **Why it works**: Creates realistic Unix rwx semantics; data files (.txt, .log, .conf) are readable but not executable. Scripts/binaries explicitly grant execute permission.
- **Rule**: Directories: `execute` matches `read`. Scripts/binaries: `execute` matches `read`. Data files: `execute: ['root']`. User-created files: `execute: ['root', owner]`.
- **Key insight**: Separating read from execute means `cat("script.js")` works but `node("script.js")` fails unless the file has explicit execute permission — CTF puzzle opportunity.

### Lazy getter for circular execution context

- **What**: `node` command needs the execution context (all commands), but node itself is part of that context. Solved with a mutable `let` variable set after building the full context, captured by a getter closure.
- **Why it works**: The getter is only called at execution time (when user runs `node("file.js")`), long after the context variable is populated during useMemo
- **Example**: `let resolved = {}; commands.set('node', createNodeCommand({ getExecutionContext: () => resolved })); resolved = executionContext;`

### Playwright E2E as living documentation

- **What**: Single sequential test that plays through all 16 CTF flags, acting as both regression test and visual demo
- **Why it works**: Catches real bugs that unit tests miss (found the su user-type bug on gateway), validates the full user experience end-to-end, `--headed` mode lets you watch the entire game play itself
- **Key patterns**: `countThenWait` for robust DOM matching in accumulating output, composite helpers (`suTo`, `sshTo`, `ftpConnect`) that encapsulate multi-step flows, `test.step` blocks for per-flag organization

### Deterministic seeds for mission E2E tests

- **What**: Use known seeds (e.g., `TEST-1-easy`, `MEDTECH-4A7F-easy`, `NOVA-7E2A-easy`) with pre-verified attack chains, credentials, and flags for E2E mission tests
- **Why it works**: Seeded generation is deterministic — same seed always produces identical network topology, users, passwords, and flag. Tests can hardcode expected values (IPs, credentials, flag strings) without runtime introspection.
- **Key patterns**: One test per entry variant (SSH, FTP, NC) covers all initial access methods. WiFi gate helper (`completeWifiGate`) shared across all mission tests since it's always a prerequisite. Mission lifecycle test (abort/re-accept) verifies state cleanup.
- **Gotcha**: To discover test data for a new seed, run `generateMissionNetwork(seed)` in a temporary vitest file and inspect the output — can't easily run standalone TypeScript on Windows due to ESM/CJS module resolution issues with tsx.

### Build-time content encoding for anti-cheat

- **What**: Pre-build script encodes all filesystem `content` strings (XOR+Base64), writes a generated module that decodes at import time
- **Why it works**: Source machine files stay readable for development and tests. Only the generated encoded module is imported by the app, so original files are tree-shaken away. Bundle contains only encoded content — `grep "FLAG{" dist/` returns zero matches.
- **Key design**: Generated file calls `decodeFileSystem(JSON.parse(json))` at import time, so downstream code (contexts, commands) receives fully decoded FileNode trees with zero changes needed.
- **Example**: `npm run encode` → `scripts/encode.ts` imports machine filesystems + secrets → encodes → writes `__encoded.ts` files → app code imports from `__encoded`
- **Gotcha**: The generated file is gitignored and must be regenerated before dev/build — `predev`/`prebuild` npm hooks handle this automatically

### JSON-stringified arrays in the secrets registry

- **What**: Store an array of mission passwords as a single `MISSION_PASSWORDS` key with `JSON.stringify([...])`, decode at runtime with `JSON.parse(secrets.MISSION_PASSWORDS)`
- **Why it works**: Reuses the existing secrets encoding pipeline with zero changes to the encode script. One key vs 20 separate keys keeps the registry clean. Tests import from the plaintext source file directly (same pattern as WiFi password).
- **Key insight**: The secrets registry handles arbitrary string values — JSON-stringified structures (arrays, objects) work just as well as plain strings, extending the anti-cheat system without additional infrastructure.

### Two-layer tab completion with cursor-aware dispatch

- **What**: `handleTab(cursorPosition)` tries path completion first (when cursor is inside a string literal), then falls through to command/variable completion
- **Why it works**: Path completion is contextual (needs filesystem access, cursor position, quote detection), while command completion is global (matches against all names). Trying the specific layer first means no ambiguity — if you're in a string, you get paths; otherwise, commands.
- **Key insight**: Passing `cursorPosition` from `TerminalInput` is essential — without it, completion can't know whether the cursor is inside `cat('rea|d')` vs after the closing quote. `requestAnimationFrame` is needed to set cursor position after React re-renders with the new input value.

### Consistent flag argument parsing across ls variants

- **What**: All `ls` commands (regular, FTP ls/lls, NC ls) share the same arg parsing pattern: filter string args, check for `-a`, find first non-flag arg as path
- **Why it works**: Consistent UX — `-a` works everywhere, dotfiles behave the same across all contexts
- **Example**: `const showAll = stringArgs.some(arg => arg.startsWith('-') && arg.includes('a'))`

### CTF flag progression through credential chains

- **What**: Flags are gated behind multi-step chains: hint file → credential → access → flag
- **Why it works**: Creates natural puzzle flow; each discovery unlocks the next step. Players can't skip ahead without finding credentials.
- **Example**: `/var/log/auth.log` mentions ftpuser → `/etc/passwd` has ftpuser's hash → crack it → FTP in → find flag in `.hidden_flag.txt`

### Per-machine server config for HTTP simulation

- **What**: Static config mapping machine IPs to server names and custom headers
- **Why it works**: Each machine's web server feels unique (Apache vs nginx, different headers)
- **Example**: webserver returns `X-Powered-By: PHP/7.4.3` and `X-Frame-Options: SAMEORIGIN`

### Cross-machine file reading for HTTP content

- **What**: curl reads `/var/www/html/` and `/var/www/api/` from remote machine filesystems via `readFileFromMachine()`
- **Why it works**: Web content lives in the same virtual filesystem as SSH/FTP content, consistent data model
- **Example**: `curl("http://webserver.local/config.php")` reads `/var/www/html/config.php` on the webserver machine

### Smart return types for mixed sync/async

- **What**: `output()` returns string for sync commands, Promise for async commands
- **Why it works**: Sync commands stay ergonomic (no await needed), async returns Promise users must handle
- **Example**: `const x = output(cat("f"))` → string; `const y = output(ping("h"))` → Promise
- **Trade-off**: Inconsistent API, but creates educational "aha" moment when user discovers Promises

### CancellationToken utility for async commands

- **What**: Shared `createCancellationToken()` in `src/utils/asyncCommand.ts` replaces duplicated `let cancelled = false; const timeoutIds = []` pattern
- **Why it works**: 9 async commands (ping, ssh, ftp, nc, nslookup, nmap, curl, decrypt, resolve) all had identical mutable cancellation boilerplate. The utility encapsulates the mutation in one place: `token.schedule(fn, delay)` and `cancel: token.cancel`
- **Key insight**: When the same mutable pattern appears across many files, extract it into a single utility that owns the mutation — callers become purely declarative

### Progression gates via session state + context gating

- **What**: WiFi hacking gate uses `session.wifiConnected` boolean + `NetworkContext` override + command wrapper to block network access until WiFi is cracked
- **Why it works**: Three-layer approach (session state → context data → command wrapper) ensures the gate works at every level: UI sees correct interfaces, commands get correct machine lists, and even bypassing context still hits the command wrapper. State persists across refresh.
- **Example**: `wifiConnected: false` → NetworkContext returns empty machines → ping wrapper throws "Network is unreachable" → ifconfig shows wlan0 DOWN

### Discriminated unions eliminate type assertions

- **What**: `OutputLine` was `{ type: string; content: string | AuthorData }` — a flat union on `content` that forced `as string` / `as AuthorData` casts everywhere. Refactored to a proper discriminated union on `type`: when `'author'` then `content: AuthorData`, otherwise `content: string`
- **Why it works**: TypeScript narrows `content` automatically in switch/if blocks — zero casts needed in `TerminalOutput.tsx`
- **Trade-off**: Construction sites need separate paths — `Terminal.tsx` split `addLine` into `addLine` (text) and `addAuthorLine` (author) since a generic function can't produce a narrowed union variant
- **Key insight**: If you find yourself casting after checking a discriminant field, the union type definition is wrong — fix the type, not the usage

### CSS custom properties for dynamic theming

- **What**: Replace Tailwind color classes with inline `style` using `var(--theme-*)` CSS custom properties, set on `document.documentElement.style`
- **Why it works**: CSS variables propagate to pseudo-elements (scrollbars, selection), body styles, and any context where React can't inject props. `:root` fallback values in `index.css` ensure correct rendering before JavaScript runs.
- **Key design decisions**:
  - Apply theme in `storageCache.ts` (before React mounts) to prevent flash of wrong colors
  - `useEffect` in `SessionContext` reapplies on `session.theme` change for runtime switching
  - camelCase token names in TypeScript → kebab-case CSS variable names via helper function
  - Link hover states handled via `onMouseEnter`/`onMouseLeave` since CSS `:hover` can't reference JS variables in inline styles
- **Gotcha**: When migrating from Tailwind classes to inline styles, all test assertions checking for class names (e.g., `text-amber-300`, `caret-amber-400`) must be updated to use `toHaveStyle({ color: 'var(--theme-text-dim)' })` etc.

### E2E selectors broke when Tailwind classes became CSS variables

- **Context**: E2E test used selectors like `div.text-amber-400`, `div.text-amber-500.pl-4`, `span.text-amber-300` to find terminal output elements
- **Issue**: The `theme()` feature replaced Tailwind color classes with inline `style` using CSS variables (`var(--theme-text-bright)` etc.), so all E2E selectors silently stopped matching — test hung waiting for elements that would never appear
- **Solution**: Added `data-testid` attributes to output elements (`terminal-banner`, `terminal-result`, `terminal-command`, `terminal-error`, `nano-status`) and updated E2E selectors to use them
- **Key insight**: E2E selectors should never depend on styling classes. Use `data-testid` attributes for test targeting — they survive CSS refactors, theme changes, and class renames. This is the same lesson as the custom cursor removal (line 163) but for E2E instead of unit tests.

### PRNG sequence preservation for seed keyword overrides

- **What**: When a seed keyword overrides a PRNG decision (e.g., `easy` forcing difficulty, `ssh` forcing entry variant), the PRNG call is still consumed but its result is discarded in favor of the override
- **Why it works**: Seeds without keywords produce identical networks as before (no regression). Seeds with keywords only change the overridden axis; everything downstream stays deterministic from the same PRNG sequence position.
- **Pattern**: `const prngResult = prng.pick(options); const actual = override ?? prngResult;`
- **Key insight**: In a deterministic PRNG pipeline, skipping a call shifts ALL downstream values. By always consuming the call, you keep the sequence stable for non-overridden decisions. This only matters for seeds without keywords (backward compatibility); seeds with keywords are new and don't need to match any prior output.

### Readonly types throughout

- **What**: All type properties marked `readonly`, arrays as `readonly T[]`
- **Why it works**: TypeScript enforces immutability at compile time, prevents accidental mutations
- **Example**: `readonly ports: readonly Port[]` instead of `ports: Port[]`

### Type guards for discriminated unions

- **What**: Create predicate functions like `isAuthorData(value): value is AuthorData`
- **Why it works**: Replaces type assertions (`as Type`) with type-safe narrowing, compiler verifies correctness
- **Example**: `if (isAsyncOutput(result)) { result.start(...) }` - no assertion needed

### `type` over `interface` for data structures

- **What**: Use `type` for all data shapes, reserve `interface` for behavior contracts (rare)
- **Why it works**: Types support unions, intersections, mapped types better; interfaces imply extensibility we don't want
- **Example**: `type Session = { readonly username: string; ... }` instead of `interface Session { ... }`

## Decisions Made

### MD5 for password hashing

- **Options considered**: bcrypt, SHA-256, MD5, plaintext
- **Decision**: MD5
- **Rationale**: CTF game context, realistic for vulnerable systems, simple implementation
- **Trade-offs**: Not secure for real apps, but fits the "hackable system" theme

### Per-machine network configs with session awareness

- **Options considered**: Single global network config, per-machine configs in separate files, per-machine map in one config
- **Decision**: Per-machine `MachineNetworkConfig` map in `NetworkConfig`, resolved via `session.machine` in `NetworkContext`
- **Rationale**: Each machine should see different interfaces/machines/DNS. Config keyed by machine ID (e.g., `'192.168.1.1'`, `'203.0.113.42'`) keeps it all in one place. `NetworkContext` just reads `session.machine` — no circular deps since `SessionProvider` wraps `NetworkProvider`.
- **Trade-offs**: Larger `initialNetwork.ts` with some duplication (machine defs shared across configs), but clear and explicit. Command factories need zero changes since getter signatures are unchanged.

### Separate network context from file system

- **Options considered**: Unified system context, separate contexts
- **Decision**: Separate NetworkContext and FileSystemContext
- **Rationale**: Different concerns, network is read-only simulation, filesystem has mutations
- **Trade-offs**: More context providers, but cleaner separation

### Session state for user/machine switching

- **Options considered**: Props drilling, global state, context
- **Decision**: SessionContext with username, userType, machine
- **Rationale**: Terminal prompt needs this everywhere, natural fit for context
- **Trade-offs**: Context re-renders, but minimal impact

### Functional programming style

- **Options considered**: OOP with classes, imperative style, functional
- **Decision**: Functional with immutable data, pure functions, readonly types
- **Rationale**: Better for React (immutability helps reconciliation), easier to test, prevents bugs
- **Trade-offs**: More verbose updates (spread operators), learning curve for mutation-heavy code

### Type guards over type assertions

- **Options considered**: Type assertions (`as Type`), type guards, runtime validation libraries
- **Decision**: Type guard functions for discriminated unions
- **Rationale**: Compiler-verified correctness, no runtime overhead, self-documenting code
- **Trade-offs**: More boilerplate (one function per variant), but safer and cleaner usage

### `type` keyword for all data structures

- **Options considered**: `interface` everywhere, `type` everywhere, mixed approach
- **Decision**: `type` for data, `interface` only for behavior contracts (none currently)
- **Rationale**: Consistent style, types handle unions/intersections better, no accidental extension
- **Trade-offs**: Slightly different syntax (= vs {), but more explicit about intent

### IndexedDB for persistence (migrated from localStorage)

- **Options considered**: No persistence, localStorage, IndexedDB, URL state
- **Decision**: IndexedDB with pre-load cache pattern
- **Rationale**: Better storage limits, structured data support, modern standard. Pre-load cache avoids loading states.
- **Trade-offs**: Async API requires pre-load bridge, but data is tiny so startup delay is imperceptible. `fake-indexeddb` needed for tests.
- **Migration**: Auto-migrates from localStorage on first run; localStorage keys removed after successful migration

### Patches approach for filesystem persistence

- **Options considered**: Persist full filesystem tree, persist only patches/diff
- **Decision**: Patches in IndexedDB
- **Rationale**: Base filesystem is already in code; only user mutations need persisting. Patches are small, deduped by machineId+path, and base filesystem updates in code still apply to returning users.
- **Trade-offs**: Need to intercept all mutation points (writeFileToMachine, createFileOnMachine), but only two exist

### Static OG image from HTML template

- **Options considered**: Dynamic server-side rendering, static SVG, HTML screenshot to PNG
- **Decision**: HTML template (`og-image.html`) screenshotted to PNG via Playwright
- **Rationale**: Full CSS control (fonts, gradients, scanlines, glow effects) produces the best visual result. SVG has font/filter limitations. Server-side rendering requires infrastructure.
- **Trade-offs**: PNG must be regenerated manually after HTML edits, but changes are rare. Playwright command: `npx playwright screenshot --viewport-size="1200,630" --full-page og-image.html og-image.png`

### Configuration-driven service ownership

- **Options considered**: Hardcoded user per command, configuration on port, separate service registry
- **Decision**: Optional `owner` field on Port type
- **Rationale**: Keeps configuration colocated, no separate registry to maintain, optional for ports that don't need it
- **Trade-offs**: Port type grows, but owner info naturally belongs with port definition

### Prettier for code formatting

- **Options considered**: ESLint formatting rules, @stylistic/eslint-plugin, Prettier, Biome
- **Decision**: Prettier with eslint-config-prettier
- **Rationale**: Industry standard, minimal config, first-class TypeScript/React/JSX support, huge editor integration. ESLint deprecated its own formatting rules.
- **Trade-offs**: Extra dependency, opinionated (but that's the point). eslint-config-prettier needed to avoid conflicts.

## Testing Patterns

### Factory functions for mock contexts

- **What**: Create `createMockContext(config)` functions that return complete mock objects with sensible defaults
- **Why it works**: Tests are isolated, each test gets fresh state, easy to override specific values
- **Example**: `const context = createMockFileSystemContext({ userType: 'guest', fileSystem: { '/root': restrictedDir } })`

### Fake timers for async commands

- **What**: Use `vi.useFakeTimers()` and `vi.advanceTimersByTime(ms)` to test async streaming commands
- **Why it works**: Tests run instantly, deterministic timing, can test intermediate states
- **Example**: `vi.advanceTimersByTime(800)` to trigger first ping response

### Type guards for async output validation

- **What**: Create `isAsyncOutput(value)` type guard to safely check command returns AsyncOutput
- **Why it works**: TypeScript narrows the type, tests can safely call `result.start()` and `result.cancel()`
- **Example**: `if (isAsyncOutput(result)) { result.start(onLine, onComplete); }`

### Behavior-focused test grouping

- **What**: Group tests by command behavior (e.g., "error handling", "listing", "formatting") not by implementation
- **Why it works**: Tests remain valid when implementation changes, documents expected behavior
- **Example**: `describe('error handling', () => { ... })`, `describe('ping execution', () => { ... })`

### Test utilities once, skip trivial wrappers

- **What**: Extract shared logic to utility, test the utility thoroughly, delete tests for thin wrappers
- **Why it works**: Reduces test duplication, tests follow the logic not the call sites
- **Example**: `stringify()` tested once in `stringify.test.ts`; `echo` command (trivial wrapper) has no tests

## Edge Cases

- curl to unknown host: "Could not resolve host" when DNS fails and not a valid IP
- curl to closed HTTP port: "Connection refused"
- curl to non-HTTP service port: "Connection refused" (validates service type)
- curl POST to non-API path: Returns 400 Bad Request with JSON error
- curl with -i flag: Shows full HTTP response headers before body
- SSH to localhost: Rejected with "cannot connect to localhost via SSH"
- SSH to machine without SSH port: "Connection refused"
- SSH with non-existent user: "Permission denied (publickey,password)"
- nmap on IP range: Scans sequentially with delays, shows live hosts only
- Empty command input: Silently ignored, no error
- su with dynamic users: Uses `getUsers()` context to support different machines
- FTP to localhost: Rejected with "cannot connect to localhost via FTP"
- FTP to machine without FTP port: "Connection refused"
- FTP get with permission denied: Checks both remote read and local write permissions
- FTP put with permission denied: Checks both local read and remote write permissions
- exit() when not connected: "exit: not connected to a remote machine"
- FTP username prompt accepts empty: Defaults to "anonymous"
- nc to localhost hostname: DNS resolution returns IP, then localhost check rejects
- nc to closed port: "Connection refused" after simulated delay
- nc to non-existent host: "Name or service not known"
- nc interactive mode: Only available on ports with "elite" service
- decrypt with wrong key: "Decryption failed - invalid key or corrupted data"
- decrypt with invalid key format: "invalid key format" (must be 64 hex chars)
- decrypt on directory: "Is a directory" error
- decrypt on empty file: "File is empty" error
- FTP/NC ls with only dotfiles (no -a): shows "(empty directory)" — consistent with regular ls
- node() on data file as non-root: "Permission denied" (file readable but not executable)
- node() on script/binary as user: succeeds (execute permission matches read)
- curl GET to path without `/var/www/html/` content: returns 404 Not Found
- curl POST to non-existent `/var/www/api/` endpoint: returns 400 Bad Request
- airmon on non-localhost: "command not available on this machine"
- airmon when WiFi already connected: "wlan0 is already connected to a network"
- airdump without monitor mode: "monitor mode not enabled"
- aircrack on WPA3 network: "WPA3 — handshake capture not supported"
- aircrack on weak signal: "Signal too weak — no handshake captured"
- aircrack on unknown BSSID: "BSSID not found — run airdump() to scan"
- Network commands on localhost before WiFi: "Network is unreachable — wlan0 is not connected"
- ifconfig on localhost before WiFi: shows wlan0 DOWN (NOT gated — player needs this)
- Mission `su` on generated machines: `getUsers()` must search mission network config, not just static config
- Mission complete banner: uses `addLine('banner', ...)` — match with `BANNER` selector, not `RESULT`
- Mission credential placements in `/var/log/auth.log`: root-only by default (regular users can't read)
- FTP entry variant credential hints: placed in `/home/{user}/` dirs which are `read: ['root', 'user']` — guest can't access
- Guest users on mission entry machines: can't call `ssh()` or `abort()` (require 'user' privilege). SSH entry variant now uses a regular user account instead of guest. `exit()` was moved to unrestricted (guest-accessible).
- NC mode path autocomplete: resolves on the NC target machine (via adapted wrappers), not localhost
- FTP mode path autocomplete: resolves on origin machine only — remote commands (`cd`, `ls`) autocomplete wrong (known limitation)
