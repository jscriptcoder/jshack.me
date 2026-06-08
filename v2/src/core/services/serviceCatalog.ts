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
 * when a slice consumes them. Slice 1 carries only what the `sshd` writer + the
 * pidfile parser need. The generator's `placement` weight (deterministic ~N% of
 * hosts) is added in Slice 2, its first consumer; CVE/version columns come with
 * the epic that needs them — never speculatively.
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
};

export const SERVICE_CATALOG = {
  ssh: { service: 'ssh', pidfile: 'sshd.pid', defaultPort: 22, runUser: 'root' },
} as const satisfies Record<string, ServiceSpec>;
