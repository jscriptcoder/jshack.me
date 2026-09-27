# Legacy app — what it was and where it lives now

jshack.me started as a React 19 + Vite + Tailwind app at the repository root. It was retired once
the Solid.js rewrite (v2) reached parity with it everywhere except missions. The last commit that
contains it is tagged **`legacy-final`** (`3b42774f`, 2026-09-27).

This folder keeps the legacy design documents. Mission ideas live separately, in
[`../mission-ideas/`](../mission-ideas/README.md), because they are the input to the missions
rebuild rather than history.

## Read the legacy source

Nothing from legacy is in the working tree any more. Read it from the tag:

```bash
# one file
git show legacy-final:src/generation/pools/scriptFix.ts

# list a directory
git ls-tree -r --name-only legacy-final src/mission

# extract a subtree into a scratch directory outside the repo
mkdir -p ../legacy-src && git archive legacy-final src/generation | tar -x -C ../legacy-src
```

On GitHub: <https://github.com/jscriptcoder/jshack.me/tree/legacy-final>.

## Pages in this folder

Every page opens with a banner saying its paths refer to the tag.

| Page                                                     | What it covers                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [architecture.md](./architecture.md)                     | Project structure, the virtual filesystem and permission model, network simulation, the mission layer |
| [infrastructure-design.md](./infrastructure-design.md)   | The WiFi gate, generated networks, machines, filesystems and logging                                   |
| [technology-choices.md](./technology-choices.md)         | The multiplayer stack decisions (Supabase, Vercel Functions, Upstash, Ed25519, zod) with alternatives |
| [supabase-setup.md](./supabase-setup.md)                 | The legacy local Docker stack and cloud dev project onboarding                                         |

## The fullest record: the rewrite blueprint

[`rewrite-blueprint/`](./rewrite-blueprint/README.md) is a seven-section snapshot of every legacy feature and design
decision. It was written so v2 could be built without reading the legacy source. Start there for
anything that is not about missions.

## Module READMEs

Legacy kept a README beside most modules. They stay at the tag and are not copied here, because
the blueprint covers the same ground:

| Module                    | README at the tag                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Commands                  | [src/commands](https://github.com/jscriptcoder/jshack.me/blob/legacy-final/src/commands/README.md)             |
| Terminal UI               | [src/components/Terminal](https://github.com/jscriptcoder/jshack.me/blob/legacy-final/src/components/Terminal/README.md) |
| Filesystem                | [src/filesystem](https://github.com/jscriptcoder/jshack.me/blob/legacy-final/src/filesystem/README.md)         |
| Game bootstrap            | [src/game](https://github.com/jscriptcoder/jshack.me/blob/legacy-final/src/game/README.md)                     |
| Seeded generators         | [src/generation](https://github.com/jscriptcoder/jshack.me/blob/legacy-final/src/generation/README.md)         |
| Home networks             | [src/homeNetworks](https://github.com/jscriptcoder/jshack.me/blob/legacy-final/src/homeNetworks/README.md)     |
| Hooks                     | [src/hooks](https://github.com/jscriptcoder/jshack.me/blob/legacy-final/src/hooks/README.md)                   |
| Identity (Ed25519)        | [src/identity](https://github.com/jscriptcoder/jshack.me/blob/legacy-final/src/identity/README.md)             |
| IP registry               | [src/ipRegistry](https://github.com/jscriptcoder/jshack.me/blob/legacy-final/src/ipRegistry/README.md)         |
| Connection logging        | [src/logging](https://github.com/jscriptcoder/jshack.me/blob/legacy-final/src/logging/README.md)               |
| `machine_filesystems`     | [src/machineFilesystems](https://github.com/jscriptcoder/jshack.me/blob/legacy-final/src/machineFilesystems/README.md) |
| Mission system            | [src/mission](https://github.com/jscriptcoder/jshack.me/blob/legacy-final/src/mission/README.md)               |
| Network                   | [src/network](https://github.com/jscriptcoder/jshack.me/blob/legacy-final/src/network/README.md)               |
| Patch registry            | [src/patchRegistry](https://github.com/jscriptcoder/jshack.me/blob/legacy-final/src/patchRegistry/README.md)   |
| Scripting helpers         | [src/scripting](https://github.com/jscriptcoder/jshack.me/blob/legacy-final/src/scripting/README.md)           |
| Anti-cheat secrets        | [src/secrets](https://github.com/jscriptcoder/jshack.me/blob/legacy-final/src/secrets/README.md)               |
| Session                   | [src/session](https://github.com/jscriptcoder/jshack.me/blob/legacy-final/src/session/README.md)               |
| Session registry          | [src/sessionRegistry](https://github.com/jscriptcoder/jshack.me/blob/legacy-final/src/sessionRegistry/README.md) |
| Signed requests           | [src/signedRequest](https://github.com/jscriptcoder/jshack.me/blob/legacy-final/src/signedRequest/README.md)   |
| Themes                    | [src/theme](https://github.com/jscriptcoder/jshack.me/blob/legacy-final/src/theme/README.md)                   |
| Themed networks           | [src/themedNetworks](https://github.com/jscriptcoder/jshack.me/blob/legacy-final/src/themedNetworks/README.md) |
| Utilities                 | [src/utils](https://github.com/jscriptcoder/jshack.me/blob/legacy-final/src/utils/README.md)                   |
| Workstation registry      | [src/workstationRegistry](https://github.com/jscriptcoder/jshack.me/blob/legacy-final/src/workstationRegistry/README.md) |
| World networks            | [src/worldNetworks](https://github.com/jscriptcoder/jshack.me/blob/legacy-final/src/worldNetworks/README.md)   |
| Scripts (dev tooling)     | [scripts](https://github.com/jscriptcoder/jshack.me/blob/legacy-final/scripts/README.md)                       |
| Playwright E2E            | [e2e](https://github.com/jscriptcoder/jshack.me/blob/legacy-final/e2e/README.md)                               |
| Product README            | [README.md](https://github.com/jscriptcoder/jshack.me/blob/legacy-final/README.md)                             |
