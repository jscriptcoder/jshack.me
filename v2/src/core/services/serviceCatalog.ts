/**
 * SERVICE_CATALOG — the single declarative home for every network service the
 * world knows about. Ported in spirit from legacy `INFRA_PID_CONFIGS`.
 *
 * Adding a service is ONE row; tuning a knob is ONE number. The `sshd` command
 * (writer), the generator (planter, Slice 2), and the pidfile readers (`nmap`,
 * later `ssh`/`ps`) all read from here, so the pidfile name/port stays DRY — one
 * description, many consumers.
 *
 * Discipline (don't gold-plate): ROWS arrive when a service ships; COLUMNS arrive
 * when a slice consumes them. Slice 1 carried only what the `sshd` writer + the
 * pidfile parser need. Slice 2 adds the GENERATION knobs — `placement` and the
 * port spread (`altPorts`/`altPortChance`), consumed by the per-host FS
 * generator. CVE/version columns come with the epic that needs them — never
 * speculatively.
 */

export type ServiceSpec = {
  /** The label `nmap` prints in the SERVICE column (e.g. `ssh`). */
  readonly service: string;
  /** The `/var/run/<pidfile>` name; its basename is the daemon written into the
   *  pidfile line (`sshd.pid` → `sshd:port=22`). */
  readonly pidfile: string;
  /** The port the daemon listens on absent an explicit override. */
  readonly defaultPort: number;
  /** The account the daemon runs as — the pidfile's owner. */
  readonly runUser: string;
  /** Slice 2 (generation): the fraction of NON-self hosts that run this service.
   *  Each host rolls independently — no per-LAN guarantee. */
  readonly placement: number;
  /** Slice 2 (generation): non-standard ports the service sometimes listens on.
   *  Empty ⇒ always `defaultPort`. */
  readonly altPorts: readonly number[];
  /** Slice 2 (generation): the chance a generated host uses an `altPorts` entry
   *  instead of `defaultPort`. */
  readonly altPortChance: number;
};

export const SERVICE_CATALOG = {
  ssh: {
    service: 'ssh',
    pidfile: 'sshd.pid',
    defaultPort: 22,
    runUser: 'root',
    placement: 0.4,
    altPorts: [2222, 8022],
    altPortChance: 0.2,
  },
  // One row for the web, not one per server program: `nginx` and `apache2` are two
  // ways to open the SAME port, so they share this identity and cannot both bind it.
  // Rarer than ssh — a box you can log into is ordinary, a box that publishes
  // something is a lead worth following.
  http: {
    service: 'http',
    pidfile: 'nginx.pid',
    defaultPort: 80,
    runUser: 'root',
    placement: 0.3,
    altPorts: [8080, 8000],
    altPortChance: 0.25,
  },
} as const satisfies Record<string, ServiceSpec>;
