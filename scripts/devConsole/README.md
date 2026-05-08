# `scripts/devConsole/`

Browser console paste-ins. **Not Node CLI scripts.**

Files in this folder are designed to be copy-pasted into the dev console of a running game tab (with `vercel:dev` or `npm run dev` serving the app). They use dynamic `import('/src/...')` to reach project modules through the Vite dev server, so they only work in the browser, against a dev build.

## Why a separate folder

The rest of `scripts/` runs via `npx tsx` against Node (network inspection, DB backfills, forge wire smokes). Mixing in scripts that ONLY make sense in a browser console would make the directory ambiguous. The folder name tells you "open dev tools, paste, hit enter" without having to read each file's header.

## Files

| File                 | Purpose                                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `setupTestPlayer.js` | Bypass IntroScreen. Write a known `gameState` into IndexedDB, clear stale state, register the workstation server-side via `/api/register-workstation`, reload. Used for two-player testing on a shared WiFi. |

## Conventions

- File extension `.js` — these are runtime JS for the browser; no compilation step. The Vite dev server resolves the `import('/src/...ts')` paths.
- Header comment block at the top of each file documents what it does, when to use it, and any caveats.
- A clearly-marked `CONFIGURE` block of constants near the top, so you can tweak inputs without scrolling.
- Idempotent where reasonable; destructive otherwise (the file's header says which).
- No external imports beyond what Vite serves from `/src/`.

## When to add a new one

If you find yourself writing a "throwaway" snippet that you keep re-typing into the console — paste it here with a header comment, commit it, and reuse next time. Most useful for setup/teardown rituals, browser-side state inspection, and bypassing UI flows for testing.
