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

export type Vulnerability = {
  readonly cve: string;
  readonly description: string;
  readonly serviceVersion: string;
  readonly attackPattern: AttackPattern;
};

export type Port = {
  readonly port: number;
  readonly service: string;
  readonly serviceVersion: string;
  readonly open: boolean;
  readonly protocol?: 'tcp' | 'udp';
  readonly owner?: ServiceOwner; // For interactive services (backdoors)
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
