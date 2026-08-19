/**
 * The pool of pages a generated host serves over HTTP, keyed by what the box is for.
 *
 * A web server is the only door that needs no credential, so this content is what
 * a reader actually gets back — it is recon material, not decoration. Each page
 * leaks the kind of thing a real server leaks: a software version, a careless
 * comment. The player's job is to read it and decide what to probe next.
 *
 * Deliberately NOT leaked here: anything that works as a credential. A page hints
 * at where to look; turning a hint into access is the wordlist's job, and pages
 * that hand out working passwords would short-circuit it. A hint the game cannot
 * honour is the same sin as a dead link — "default password unchanged" would send a
 * player after a mechanic that does not exist.
 *
 * **No page links a path its host does not serve.** These pages used to advertise
 * `/admin/`, `/status`, `/server-status`, `/.well-known/security.txt`,
 * `/api/health` and `/metrics`, none of which exist on a generated box — so the
 * recon a page invited always dead-ended, and a text browser would have made that
 * its headline interaction rather than a footnote. The links went instead of the
 * pages arriving, because inventing the pages here would have set the pool shape
 * and per-box volume that generated world content owns as its own design. When
 * that lands and a host serves what it links, the link markup comes back — and
 * the property test in `remoteHostFs.test.ts` is what keeps the two honest.
 *
 * **Which roles get their own bucket was measured, not guessed.** Across 40
 * generated LANs the boxes answering on `:80` are 30% webservers, 27% workstations
 * and 24% cameras, the rest a long tail. The general bucket already reads as a
 * webserver's, so the two buckets that close the contradiction are `iot` and
 * `workstation` — a `cam-31` serving an internal corporate portal is the obvious
 * lie, and a `laptop-7` serving one is the same lie a player happens to meet more
 * often. `database` and `fileserver` are the deferred tail; both already say what
 * they are through the config file in `/etc`.
 *
 * The table is sparse on purpose, unlike `rolePlacement`'s full record: an absent
 * row here means "nothing particular to serve", and falling back to the general
 * bucket is the right answer to that rather than a gap.
 */

import { createPrng } from '../prng';
import type { DrawnRole } from '../machineRole';

/** Interpolated into a template wherever the host's name belongs. */
const HOSTNAME_PLACEHOLDER = /\{\{hostname\}\}/g;

/** What a box with nothing particular to say serves — and what a webserver serves,
 *  since a corporate portal or a reverse proxy is exactly what one is for. */
const GENERAL_SERVER_PAGES: readonly string[] = [
  '<html>\n<head><title>{{hostname}} — Status</title></head>\n<body>\n<h1>{{hostname}}</h1>\n<p>Server operational. Build 4.2.1</p>\n<!-- deploy: automated via CI/CD pipeline -->\n</body>\n</html>',
  '<html>\n<head><title>Welcome — {{hostname}}</title></head>\n<body>\n<h1>Welcome to {{hostname}}</h1>\n<p>Internal corporate portal v3.1.0</p>\n<!-- TODO: remove debug endpoints before release -->\n</body>\n</html>',
  '<html>\n<head><title>{{hostname}} — nginx</title></head>\n<body>\n<h1>{{hostname}}</h1>\n<p>nginx reverse proxy — upstream: 127.0.0.1:8080</p>\n<p>SSL: enabled | HTTP/2: enabled</p>\n<!-- nginx/1.24.0 -->\n</body>\n</html>',
  '<html>\n<head><title>{{hostname}} — Application Server</title></head>\n<body>\n<h1>{{hostname}} App Server</h1>\n<p>Node.js v18.17.0 | PM2 cluster mode</p>\n<p>Workers: 4/4 | Memory: 312MB | Uptime: 18d 4h</p>\n<!-- Express 4.18.2 -->\n</body>\n</html>',
];

const IOT_PAGES: readonly string[] = [
  '<html>\n<head><title>{{hostname}} — Live View</title></head>\n<body>\n<h1>{{hostname}}</h1>\n<p>Stream: rtsp://{{hostname}}:554/live — 1920x1080 @ 15fps</p>\n<p>Firmware 2.1.4 | Motion detection: on</p>\n<!-- ONVIF profile S, motion zones last edited 2019 -->\n</body>\n</html>',
  '<html>\n<head><title>{{hostname}} — Device</title></head>\n<body>\n<h1>{{hostname}}</h1>\n<p>Sensor gateway | Firmware 1.8.2 | Uptime 214d</p>\n<p>Paired devices: 6 | Last reading 21.4C</p>\n<!-- mqtt bridge restarted nightly by cron -->\n</body>\n</html>',
  '<html>\n<head><title>{{hostname}} — Snapshot</title></head>\n<body>\n<h1>{{hostname}}</h1>\n<p>Latest snapshot: 1280x720, 4s ago</p>\n<p>Storage: microSD 32GB, 78% full — oldest clip 2021-03-11</p>\n<!-- snapshot cache served from tmpfs, wiped on reboot -->\n</body>\n</html>',
  '<html>\n<head><title>{{hostname}} — Camera Admin</title></head>\n<body>\n<h1>{{hostname}}</h1>\n<p>Model IPC-2400 | Firmware 3.0.1-beta | Channel 2 of 4</p>\n<p>Night mode: auto | Timezone: UTC</p>\n<!-- beta firmware flashed by hand, never rolled back -->\n</body>\n</html>',
];

const WORKSTATION_PAGES: readonly string[] = [
  '<html>\n<head><title>{{hostname}} — dev</title></head>\n<body>\n<h1>{{hostname}}</h1>\n<p>Vite dev server on localhost:5173 — HMR connected</p>\n<!-- npm run dev -- --host, left running over the weekend -->\n</body>\n</html>',
  '<html>\n<head><title>It works!</title></head>\n<body>\n<h1>It works!</h1>\n<p>nginx/1.18.0 default page on {{hostname}}</p>\n<!-- /var/www/html untouched since the install -->\n</body>\n</html>',
  '<html>\n<head><title>{{hostname}} — notes</title></head>\n<body>\n<h1>{{hostname}} notes</h1>\n<p>Personal wiki — 41 pages, last edited yesterday</p>\n<!-- served straight off ~/notes, no backup configured -->\n</body>\n</html>',
  '<html>\n<head><title>{{hostname}}</title></head>\n<body>\n<h1>{{hostname}}</h1>\n<p>Static site preview — Hugo 0.121.1, built 3h ago</p>\n<p>Serving from localhost, draft posts included</p>\n<!-- python3 -m http.server, still up from this morning -->\n</body>\n</html>',
];

/** Keyed by role OR by the absence of one, so the lookup is total: a box whose name
 *  claims no role is an ordinary case, not a gap to guard against. */
const PAGES_BY_ROLE: ReadonlyMap<DrawnRole | undefined, readonly string[]> = new Map<
  DrawnRole | undefined,
  readonly string[]
>([
  ['iot', IOT_PAGES],
  ['workstation', WORKSTATION_PAGES],
]);

/**
 * The page `hostname` serves, drawn deterministically from `seed`.
 *
 * A role with no bucket of its own — and a host whose name claims no role at all —
 * draws from the general bucket. `pick` consumes one `next()` whatever the pool's
 * length, so keying the pool by role moves no draw: a box with no bucket lands on
 * exactly the page it landed on before this table existed.
 *
 * The seed is the caller's to compose and is deliberately its OWN draw rather than
 * a continuation of the host's other generation draws: appending to a shared PRNG
 * sequence would re-roll every value picked after it, so a new pool would silently
 * change existing accounts and ports.
 */
export const pickWebPage = ({
  role,
  seed,
  hostname,
}: {
  readonly role: DrawnRole | undefined;
  readonly seed: string;
  readonly hostname: string;
}): string =>
  createPrng(seed)
    .pick(PAGES_BY_ROLE.get(role) ?? GENERAL_SERVER_PAGES)
    .replace(HOSTNAME_PLACEHOLDER, hostname);
