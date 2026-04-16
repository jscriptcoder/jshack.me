export type NetworkInterface = {
  readonly name: string;
  readonly flags: readonly string[];
  readonly inet: string;
  readonly netmask: string;
  readonly gateway: string;
  readonly mac: string;
};

export type ServiceOwner = {
  readonly username: string;
  readonly userType: 'root' | 'user' | 'guest';
  readonly homePath: string;
};

// Severity tiers for Vulnerability. Phase 3 backfills with critical/high/
// medium/low only — all four produce the same mechanical outcome in PR B
// (msfconsole gives a shell). `info` is reserved for Phase 4 alongside typed
// effects: info-severity CVEs produce non-shell outcomes like dir listings
// or banner leaks. msfconsole treats info-severity CVEs as absent in Phase 3.
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

// Discriminated union describing what a vulnerability exploit attempt looks
// like in the target's logs. Each variant knows which log file the entry
// lands in and carries enough content for the log formatter to produce a
// realistic line. Used by the onExploitAttempt callback to dispatch writes.
export type AttackPattern =
  | {
      readonly logFile: '/var/log/access.log';
      readonly method: 'GET' | 'POST';
      readonly path: string;
      readonly status: number;
    }
  | {
      readonly logFile: '/var/log/vsftpd.log';
      readonly command: string;
    }
  | {
      readonly logFile: '/var/log/mysql.log';
      readonly query: string;
    }
  | {
      readonly logFile: '/var/log/redis.log';
      readonly message: string;
    }
  | {
      readonly logFile: '/var/log/mail.log';
      readonly daemon: 'postfix/smtpd' | 'dovecot' | 'courier';
      readonly message: string;
    }
  | {
      readonly logFile: '/var/log/syslog';
      readonly daemon: string;
      readonly message: string;
    };

// Discriminated union of exploit outcomes. The effect kind determines what
// msfconsole does on a successful exploit: grant a shell, read a file,
// write a file, list a directory, reset a password, open a backdoor port,
// or execute a player-supplied script on the target.
export type EffectTier = 'guest' | 'user' | 'root';

export type VulnerabilityEffect =
  | { readonly kind: 'shell_limited'; readonly tier: EffectTier }
  | { readonly kind: 'shell_full'; readonly tier: EffectTier }
  | { readonly kind: 'file_read'; readonly tier: EffectTier }
  | { readonly kind: 'dir_list'; readonly tier: EffectTier }
  | { readonly kind: 'file_write'; readonly tier: EffectTier }
  | { readonly kind: 'password_reset'; readonly tier: EffectTier }
  | { readonly kind: 'backdoor_port_open'; readonly port: number; readonly tier: EffectTier }
  | { readonly kind: 'script_exec'; readonly tier: EffectTier };

export type Vulnerability = {
  readonly cve: string;
  readonly description: string;
  readonly serviceVersion: string;
  readonly attackPattern: AttackPattern;
  readonly severity: Severity;
  // Game day (relative to session startedAt) when this CVE becomes "live" in
  // the game world. Phase 3 PR B backfills every existing CVE with 0. Future
  // content PRs add entries with positive publishedAt values to create the
  // treadmill cycle.
  readonly publishedAt: number;
  readonly effect: VulnerabilityEffect;
};

export type Port = {
  readonly port: number;
  readonly service: string;
  readonly serviceVersion: string;
  readonly open: boolean;
  readonly protocol?: 'tcp' | 'udp';
  readonly owner?: ServiceOwner; // For interactive services (backdoors)
  // When set, overrides the vulnerability's natural effect. Used by SSH
  // closure enrichment (guarantees script_exec for recovery) and seed
  // keyword overrides (testing/gameplay control). findExploitableCve
  // synthesizes a minimal vulnerability if no natural one exists.
  readonly forcedEffect?: VulnerabilityEffect;
};

export type RemoteUser = {
  readonly username: string;
  readonly passwordHash: string;
  readonly userType: 'root' | 'user' | 'guest';
};

export type RemoteMachine = {
  readonly ip: string;
  readonly hostname: string;
  readonly ports: readonly Port[];
  readonly users: readonly RemoteUser[];
  // Router-only. Chosen at generation time by the topology seeder and
  // consumed by findFirmwareCve / msfconsole / apt upgrade firmware.
  // Undefined for non-router machines.
  readonly firmwareVendor?: string;
  // Router-only. Mutable — reflects the firmware version currently installed
  // on the router as read from /var/lib/dpkg/status via applyVersionOverlay.
  // Undefined on non-routers and on routers whose status file has no
  // `firmware` package entry.
  readonly firmwareVersion?: string;
};

export type DnsRecord = {
  readonly domain: string;
  readonly ip: string;
  readonly type: 'A';
};

export type MachineNetworkConfig = {
  readonly interfaces: readonly NetworkInterface[];
  readonly machines: readonly RemoteMachine[];
  readonly dnsRecords: readonly DnsRecord[];
};

export type NetworkConfig = {
  readonly machineConfigs: Readonly<Record<string, MachineNetworkConfig>>;
};
