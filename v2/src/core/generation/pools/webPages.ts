/**
 * The pool of pages a generated host serves over HTTP.
 *
 * A web server is the only door that needs no credential, so this content is what
 * a reader actually gets back — it is recon material, not decoration. Each page
 * leaks the kind of thing a real server leaks: a software version, a careless
 * comment. The player's job is to read it and decide what to probe next.
 *
 * Deliberately NOT leaked here: anything that works as a credential. A page hints
 * at where to look; turning a hint into access is the wordlist's job, and pages
 * that hand out working passwords would short-circuit it.
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
 * `pickWebPage` is the single entry point on purpose. The pages are flat today
 * because a generated host has no kind yet — every box is drawn from one pool. When
 * hosts gain a kind (a database box, a camera, a gateway), this grows a `role`
 * argument and the pool becomes role-keyed buckets; today's entries are the
 * general-server bucket, so that change is additive and no caller moves.
 */

import { createPrng } from '../prng';

/** Interpolated into a template wherever the host's name belongs. */
const HOSTNAME_PLACEHOLDER = /\{\{hostname\}\}/g;

const WEB_PAGES: readonly string[] = [
  '<html>\n<head><title>{{hostname}} — Status</title></head>\n<body>\n<h1>{{hostname}}</h1>\n<p>Server operational. Build 4.2.1</p>\n<!-- deploy: automated via CI/CD pipeline -->\n</body>\n</html>',
  '<html>\n<head><title>Welcome — {{hostname}}</title></head>\n<body>\n<h1>Welcome to {{hostname}}</h1>\n<p>Internal corporate portal v3.1.0</p>\n<!-- TODO: remove debug endpoints before release -->\n</body>\n</html>',
  '<html>\n<head><title>{{hostname}} — nginx</title></head>\n<body>\n<h1>{{hostname}}</h1>\n<p>nginx reverse proxy — upstream: 127.0.0.1:8080</p>\n<p>SSL: enabled | HTTP/2: enabled</p>\n<!-- nginx/1.24.0 -->\n</body>\n</html>',
  '<html>\n<head><title>{{hostname}} — Application Server</title></head>\n<body>\n<h1>{{hostname}} App Server</h1>\n<p>Node.js v18.17.0 | PM2 cluster mode</p>\n<p>Workers: 4/4 | Memory: 312MB | Uptime: 18d 4h</p>\n<!-- Express 4.18.2 -->\n</body>\n</html>',
];

/**
 * The page `hostname` serves, drawn deterministically from `seed`.
 *
 * The seed is the caller's to compose and is deliberately its OWN draw rather than
 * a continuation of the host's other generation draws: appending to a shared PRNG
 * sequence would re-roll every value picked after it, so a new pool would silently
 * change existing accounts and ports.
 */
export const pickWebPage = ({
  seed,
  hostname,
}: {
  readonly seed: string;
  readonly hostname: string;
}): string => createPrng(seed).pick(WEB_PAGES).replace(HOSTNAME_PLACEHOLDER, hostname);
