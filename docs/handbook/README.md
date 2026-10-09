# jshack.me maintainer's handbook

This handbook is for an engineer taking over jshack.me. It explains how the whole game is built
(architecture, components, algorithms, data, deployment and testing) well enough to maintain and
extend it without the original author and without an AI assistant. It describes the code as it is at
v0.278.0 (2026-09-27). When the handbook and the code disagree, the code is right; fix the handbook.

## Start here

1. Read [**1. Architecture overview**](./01-architecture.md) in full. It is the map for everything
   else.
2. Follow [**2. Local development**](./02-local-development.md) until the game runs at
   `http://localhost:3100` against a local database and the tests pass.
3. Skim [**3. Codebase map**](./03-codebase-map.md) and the [glossary](./glossary.md).
4. Read [**13. Known issues**](./13-known-issues.md). One item is time-sensitive (a test that starts
   failing on 2027-01-08).
5. Then read the chapter for whatever you are about to change.

## Chapters

| Chapter                                                                    | Read it when you are…                                                                                          |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [1. Architecture overview](./01-architecture.md)                           | New to the project. The core ideas, technologies, layers, and one command end to end.                          |
| [2. Local development](./02-local-development.md)                          | Setting up, or looking for a command.                                                                          |
| [3. Codebase map](./03-codebase-map.md)                                    | Looking for where something lives.                                                                             |
| [4. The client runtime](./04-client-runtime.md)                            | Touching `src/ui/`: boot, state, the terminal, the editor and browser screens, tabs, themes, the `CommandEnv`. |
| [5. The shell and commands](./05-shell-and-commands.md)                    | Adding or changing a command, the parser, pipes, scripting, `apt`. Includes the command catalog.               |
| [6. World generation](./06-world-generation.md)                            | Changing what networks and machines contain, the random streams, services, budgets.                            |
| [7. Network, filesystem and scanning](./07-network-filesystem-scanning.md) | Changing topology, addressing, reachability, firewalls, the filesystem model, `nmap`, DNS, SNMP.               |
| [8. Sessions and vulnerabilities](./08-sessions-and-vulnerabilities.md)    | Changing logins, sessions, the database/store doors, vulnerabilities, findit.io, or log traces.                |
| [9. Identity, persistence and sync](./09-persistence-and-multiplayer.md)   | Changing what is saved, the patch journal, signing, or how the browser stays in sync.                          |
| [10. Server and database](./10-server-and-database.md)                     | Adding an API action, a table or a migration. Full action and schema reference.                                |
| [11. Testing and quality](./11-testing-and-quality.md)                     | Writing any test, running mutation testing, or preparing a pull request.                                       |
| [12. Build, deploy and operate](./12-build-deploy-operate.md)              | Deploying, rolling back, changing the cloud schema, or debugging "works locally, not in production".           |
| [13. Known issues](./13-known-issues.md)                                   | Planning maintenance work. Risks, open questions, doc and comment drift.                                       |
| [Glossary](./glossary.md)                                                  | Meeting an unfamiliar term.                                                                                    |

## I want to…

| Task                               | Go to                                                                                                                                                                                                           |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add a terminal command             | [Ch. 5, "How to add a command"](./05-shell-and-commands.md#how-to-add-a-command)                                                                                                                                |
| Add a full-screen app like `nano`  | [Ch. 4, "Add a full-screen overlay app"](./04-client-runtime.md#add-a-full-screen-overlay-app)                                                                                                                  |
| Give commands a new capability     | [Ch. 4, "Give commands a new capability"](./04-client-runtime.md#give-commands-a-new-capability-a-new-commandenv-seam)                                                                                          |
| Add content to generated machines  | [Ch. 6, "Add generated content"](./06-world-generation.md#add-generated-content-to-existing-boxes), then [`world-content-architecture.md`](../world-content-architecture.md)                                    |
| Add a network service              | [Ch. 6, "Add a network service"](./06-world-generation.md#add-a-network-service) and [Ch. 7, "Add a new data door"](./07-network-filesystem-scanning.md#add-a-new-data-door-a-service-reached-over-the-network) |
| Add a town to the world            | [Ch. 6, "Add a town"](./06-world-generation.md#add-a-town), then [`procedural-world-architecture.md`](../procedural-world-architecture.md)                                                                      |
| Add a login door or session kind   | [Ch. 8](./08-sessions-and-vulnerabilities.md#add-a-new-login-door-a-new-session-kind)                                                                                                                           |
| Add a vulnerable package or effect | [Ch. 8](./08-sessions-and-vulnerabilities.md#add-a-vulnerable-package-or-a-new-effect) and [`vulnerability-architecture.md`](../vulnerability-architecture.md)                                                  |
| Add a server API action            | [Ch. 10, "Add an API action"](./10-server-and-database.md#add-an-api-action) and [Ch. 9](./09-persistence-and-multiplayer.md#add-a-signed-api-call)                                                             |
| Add a database table or column     | [Ch. 10, "Add a migration"](./10-server-and-database.md#add-a-migration)                                                                                                                                        |
| Write a wire-check                 | [Ch. 11](./11-testing-and-quality.md#a-wire-check)                                                                                                                                                              |
| Mutation-test a file               | [Ch. 11](./11-testing-and-quality.md#recipe-mutation-test-one-file)                                                                                                                                             |
| Deploy or roll back                | [Ch. 12](./12-build-deploy-operate.md#releasing)                                                                                                                                                                |
| Fix "every request fails locally"  | [Ch. 2](./02-local-development.md#run-the-game), then [Ch. 12 gotchas](./12-build-deploy-operate.md#operational-gotchas)                                                                                        |

## Ten things to know on day one

1. **The world is computed from seeds, not stored.** Only players' changes are in the database, as
   whole-file patches replayed over generated machines.
2. **Files are the source of truth** for running services, firewall rules, installed commands,
   package versions and whether a machine boots.
3. **`src/core/` runs in both the browser and the server.** The client uses it to render; the server
   uses the same code to authorize.
4. **The server decides everything that matters to other players** (logins, tiers, exploits, remote
   writes, time, log lines); the client only sends intentions.
5. **A player is an Ed25519 keypair in `localStorage`.** Every request is signed; there are no
   accounts.
6. **Every file in `api/` is a deployed endpoint**, and every relative import must end in `.js`.
7. **There is no CI.** Run `npm run typecheck`, `npm run lint`, `npm run test:run`, `npm run build`
   and the relevant wire-checks yourself before merging.
8. **Never add a draw to an existing random stream**; create a new one, or the world shifts under
   every player.
9. **Start the local server with `npm run vercel:dev`**, never a bare `vercel dev`.
10. **Bump the version** in `package.json` and `package-lock.json` on feature changes (most merged fixes bump it too).

## The other documentation

The handbook is the entry point. These documents go deeper into specific shipped systems and are
linked from the relevant chapters:

- [`project-status.md`](../project-status.md): where the project stands and where to pick up.
- [`conventions-and-gotchas.md`](../conventions-and-gotchas.md): the long-form record of working
  conventions, testing and mutation lessons, operational gotchas and architecture invariants.
  Search it; it is not meant to be read end to end.
- [`backlog.md`](../backlog.md): deliberately deferred work and future content ideas.
- [`cross-player-architecture.md`](../cross-player-architecture.md),
  [`world-content-architecture.md`](../world-content-architecture.md),
  [`procedural-world-architecture.md`](../procedural-world-architecture.md),
  [`discovery-architecture.md`](../discovery-architecture.md),
  [`vulnerability-architecture.md`](../vulnerability-architecture.md): as-built deep dives.
- [`e2e-shared-network-verification.md`](../e2e-shared-network-verification.md): two-player browser
  journeys.
- [`legacy/`](../legacy/README.md) and [`mission-ideas/`](../mission-ideas/README.md): history, and
  input for the planned missions feature.

## Keeping this handbook true

- Update the chapter in the same pull request as the behaviour it describes.
- Numbers that change (test counts, command counts, catalog size, versions) are dated; refresh them
  or remove them rather than letting them drift.
- When you fix or decide something in [known issues](./13-known-issues.md), delete its entry.
- Diagrams are Mermaid, which GitHub renders. Keep them small and keep the sentence under each one
  accurate; it carries the meaning if the diagram does not render.
