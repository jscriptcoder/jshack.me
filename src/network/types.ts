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

export type Vulnerability = {
  readonly cve: string;
  readonly description: string;
  readonly serviceVersion: string;
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
