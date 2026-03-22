import { useState, useEffect, useRef } from 'react';

type BootScreenProps = {
  readonly workstationName: string;
  readonly username: string;
  readonly onComplete: () => void;
};

type BootLine = {
  readonly text: string;
  readonly delay: number;
  readonly color?: string;
};

const buildBootSequence = (hostname: string, username: string): readonly BootLine[] => [
  { text: 'BIOS: Initializing system...', delay: 200, color: 'var(--theme-text-dim)' },
  { text: 'BIOS: Memory test... 4096 MB OK', delay: 150, color: 'var(--theme-text-dim)' },
  { text: '', delay: 100 },
  {
    text: 'Loading Linux 5.15.0-91-generic ...',
    delay: 300,
    color: 'var(--theme-text)',
  },
  { text: 'Loading initial ramdisk ...', delay: 250, color: 'var(--theme-text)' },
  { text: '', delay: 100 },
  {
    text: '[    0.000000] Linux version 5.15.0-91-generic (buildd@lcy02-amd64-045)',
    delay: 80,
  },
  { text: '[    0.000000] Command line: BOOT_IMAGE=/boot/vmlinuz-5.15.0-91-generic', delay: 60 },
  {
    text: '[    0.012345] x86/fpu: Supporting XSAVE feature: x87 floating point registers',
    delay: 40,
  },
  { text: '[    0.024680] ACPI: RSDP 0x00000000000E0000 000024 (v02 VBOX  )', delay: 40 },
  { text: '[    0.048000] Memory: 4048576K/4194304K available', delay: 60 },
  { text: '[    0.096000] CPU: Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz', delay: 60 },
  { text: '[    0.128000] PCI: Using configuration type 1 for base access', delay: 40 },
  { text: '[    0.256000] NET: Registered PF_NETLINK/PF_ROUTE protocol family', delay: 40 },
  { text: '[    0.512000] EXT4-fs (sda1): mounted filesystem with ordered data mode', delay: 80 },
  { text: '', delay: 100 },
  {
    text: `[    0.640000] systemd[1]: Set hostname to <${hostname}>.`,
    delay: 120,
    color: 'var(--theme-text)',
  },
  { text: '[  OK  ] Created slice system.slice.', delay: 80, color: 'var(--theme-text)' },
  { text: '[  OK  ] Started Journal Service.', delay: 80 },
  { text: '[  OK  ] Reached target Local File Systems.', delay: 60 },
  { text: '[  OK  ] Started Login Service.', delay: 80 },
  { text: '[  OK  ] Started Network Manager.', delay: 100 },
  { text: '[  OK  ] Started OpenSSH server.', delay: 80 },
  {
    text: '[  OK  ] Found device wlan0 — Wireless Network Interface.',
    delay: 100,
  },
  { text: '[  OK  ] Reached target Network.', delay: 80 },
  { text: '[  OK  ] Reached target Multi-User System.', delay: 100 },
  { text: '', delay: 150 },
  {
    text: `${hostname} login: ${username} (automatic login)`,
    delay: 300,
    color: 'var(--theme-text)',
  },
  { text: '', delay: 200 },
];

export const BootScreen = ({ workstationName, username, onComplete }: BootScreenProps) => {
  const [lines, setLines] = useState<readonly string[]>([]);
  const [colors, setColors] = useState<readonly (string | undefined)[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sequence = buildBootSequence(workstationName, username);
    let currentDelay = 0;
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    sequence.forEach((line, i) => {
      currentDelay += line.delay;
      const timeout = setTimeout(() => {
        setLines((prev) => [...prev, line.text]);
        setColors((prev) => [...prev, line.color]);
      }, currentDelay);
      timeouts.push(timeout);

      // After the last line, trigger onComplete
      if (i === sequence.length - 1) {
        const completeTimeout = setTimeout(onComplete, currentDelay + 400);
        timeouts.push(completeTimeout);
      }
    });

    return () => timeouts.forEach(clearTimeout);
  }, [workstationName, username, onComplete]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto p-4 font-mono text-xs leading-relaxed sm:text-sm"
      style={{ color: 'var(--theme-text-dim)' }}
    >
      {lines.map((line, i) => (
        <div key={i} style={colors[i] ? { color: colors[i] } : undefined}>
          {line || '\u00A0'}
        </div>
      ))}
    </div>
  );
};
