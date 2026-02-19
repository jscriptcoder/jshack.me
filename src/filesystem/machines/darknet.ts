import type { FileNode } from '../types';
import { createFileSystem, type MachineFileSystemConfig } from '../fileSystemFactory';

// FLAG 12: Encrypted final flag (AES-256-GCM)
// Key: 82eab922d375a8022d7659b58559e59026dbff2768110073a6c3699a15699eda
// Decrypts to completion message with FLAG{master_of_the_darknet}
const encryptedFinalFlag =
  'XMnSrN8aYVwDjrjbXfpv5tKSigt/QuNwZCMVGFUNQCDa3nlUDX7y6lSjH2LkFjTGqsytTqsLikzm' +
  'zcFqcs40yArp7Ve2qq46m4RHqCf1DpA1IU9UofbXEpL07JhAJNrEOUYgHvsryOepgZrULnK3cJY2' +
  'Psi83f9Pwv3PXvSk3YllGlGvYeJXC1LXAHxjnWsGATPR5/0Ps5K3iblqQo3g9/OTAddGCJPYHku' +
  'XcUcZFyfxl/N/QzCx+A0elQH7sU6nOW3aK8WVRSu17kaD9J+1d3nI1GJ89sZtGY6QseffEcy7bp' +
  '1nT9X1jiKwn6a+eLTp/I26XiUc0DmhGNrszdfBFden3bhGqSIXopwSwRcUeuvmO+WQ5aKkpvCOgI' +
  '+4SmgbPJYEZd5Jvj8vqU06Y1J7utbtSJ5vs7Dy06m4oGA=';

// Ghost's home directory content
const ghostHome: Readonly<Record<string, FileNode>> = {
  '.encrypted_flag.enc': {
    name: '.encrypted_flag.enc',
    type: 'file',
    owner: 'user',
    permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: ['root'] },
    content: encryptedFinalFlag,
  },
  '.notes': {
    name: '.notes',
    type: 'file',
    owner: 'user',
    permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: ['root'] },
    content: `The final flag is encrypted.
You need root to use decrypt().
The key is in /root/keyfile.txt.
Check the logs to find root's password.
`,
  },
  '.bash_history': {
    name: '.bash_history',
    type: 'file',
    owner: 'user',
    permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: ['root'] },
    content: `nmap -sV 192.168.1.0/24
ssh www-data@192.168.1.75
cat /opt/tools/.backdoor_log
nc 192.168.1.75 4444
python3 tools/port_scanner.py 192.168.1.75
ls -la /var/log
cat /var/log/auth.log
su root
ls projects
cat projects/README.md
`,
  },
  tools: {
    name: 'tools',
    type: 'directory',
    owner: 'user',
    permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: ['root', 'user'] },
    children: {
      'port_scanner.py': {
        name: 'port_scanner.py',
        type: 'file',
        owner: 'user',
        permissions: {
          read: ['root', 'user'],
          write: ['root', 'user'],
          execute: ['root', 'user'],
        },
        content: `#!/usr/bin/env python3
"""Simple port scanner - ghost's toolkit"""
import socket
import sys

def scan(target, ports=range(1, 1024)):
    print(f"Scanning {target}...")
    for port in ports:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(0.5)
            result = s.connect_ex((target, port))
            if result == 0:
                print(f"  Port {port}: OPEN")
            s.close()
        except:
            pass

if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1"
    scan(target)
`,
      },
      'README.md': {
        name: 'README.md',
        type: 'file',
        owner: 'user',
        permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: ['root'] },
        content: `# Ghost's Toolkit

Collection of recon and exploitation scripts.

## Tools
- port_scanner.py — TCP port scanner
- More tools available on the C2 server

## Notes
- Webserver backdoor on port 4444 (www-data)
- Local backdoor on port 31337
- Always clean logs after access
`,
      },
    },
  },
  '.contracts': {
    name: '.contracts',
    type: 'file',
    owner: 'user',
    permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: ['root'] },
    content: `=== DARKNET MARKETPLACE ===

New contracts are available on the mission board.

After completing the tutorial flags, type:

  missions()

to browse available hacker-for-hire jobs.

Use accept("SEED") to start a contract.
`,
  },
  projects: {
    name: 'projects',
    type: 'directory',
    owner: 'user',
    permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: ['root', 'user'] },
    children: {
      'README.md': {
        name: 'README.md',
        type: 'file',
        owner: 'user',
        permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: ['root'] },
        content: `# Bonus Challenge: Code the Decoder

You found an encoded message. No built-in command can decode it.

The encoding is ROT13 — each letter is shifted 13 places in the alphabet.

## Your mission

1. Read the encoded message: cat("encoded_message.txt")
2. Write a decoder script: nano("decode.js")
3. Run it: node("decode.js")

## Hints

- ROT13 maps A-M to N-Z and N-Z to A-M (same for lowercase)
- Use cat() to read files, echo() to print output
- Non-letter characters (digits, braces, underscores) stay unchanged
`,
      },
      'encoded_message.txt': {
        name: 'encoded_message.txt',
        type: 'file',
        owner: 'user',
        permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: ['root'] },
        content: `OBAHF SYNT HAYBPXRQ

SYNT{pbqr_gur_qrpbqre}

Lbh jebgr WninFpevcg gb unpx n unpxre'f znpuvar.
Gung'f gur gehr fcvevg bs WFUNPX.ZR.

Glcr nhgube() gb yrnea nobhg gur perngbe.
`,
      },
    },
  },
};

const darknetConfig: MachineFileSystemConfig = {
  users: [
    {
      username: 'root',
      passwordHash: '63d7f708b7feb9c0494c64dbfb087f83',
      userType: 'root',
      uid: 0,
    }, // d4rkn3tR00t
    {
      username: 'ghost',
      passwordHash: 'd2aef0b37551aecfb067036d57f14930',
      userType: 'user',
      uid: 1000,
      homeContent: ghostHome,
    }, // sp3ctr3
    {
      username: 'guest',
      passwordHash: 'e5ec4133db0a2e088310e8ecb0ee51d7',
      userType: 'guest',
      uid: 1001,
    }, // sh4d0w
  ],
  etcExtraContent: {
    hostname: {
      name: 'hostname',
      type: 'file',
      owner: 'root',
      permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] },
      content: 'darknet\n',
    },
    hosts: {
      name: 'hosts',
      type: 'file',
      owner: 'root',
      permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] },
      content: `127.0.0.1       localhost darknet
203.0.113.42    darknet.ctf www.darknet.ctf
10.66.66.1      shadow.onion
10.66.66.2      void.onion
10.66.66.3      abyss.onion
`,
    },
  },
  // Key for FLAG 12 decryption
  rootContent: {
    'keyfile.txt': {
      name: 'keyfile.txt',
      type: 'file',
      owner: 'root',
      permissions: { read: ['root'], write: ['root'], execute: ['root'] },
      content: `# AES-256-GCM Decryption Key
# Use with: decrypt("/home/ghost/.encrypted_flag.enc", key)

82eab922d375a8022d7659b58559e59026dbff2768110073a6c3699a15699eda
`,
    },
    '.bash_history': {
      name: '.bash_history',
      type: 'file',
      owner: 'root',
      permissions: { read: ['root'], write: ['root'], execute: ['root'] },
      content: `systemctl restart tor
iptables -L -n
cat /var/log/auth.log
ls /home/ghost
cat /home/ghost/.notes
systemctl status encrypted-services
nmap 10.66.66.0/24
`,
    },
    '.hidden_network': {
      name: '.hidden_network',
      type: 'file',
      owner: 'root',
      permissions: { read: ['root'], write: ['root'], execute: ['root'] },
      content: `HIDDEN NETWORK ACCESS
=====================

Nodes discovered on 10.66.66.0/24 subnet:

  shadow  (10.66.66.1)  — FTP (21), SSH (22)
    Exports available via anonymous FTP (guest / demo)

  void    (10.66.66.2)  — SSH (22), maintenance (9999)
    Diagnostics endpoint on port 9999

  abyss   (10.66.66.3)  — SSH (22)
    Locked down. Credentials unknown.
    Check void for intel.

Default guest credentials: guest / demo
`,
    },
  },
  // FLAG 11: Web content + API + HINT: auth.log with root password
  extraDirectories: {
    var: {
      name: 'var',
      type: 'directory',
      owner: 'root',
      permissions: {
        read: ['root', 'user', 'guest'],
        write: ['root'],
        execute: ['root', 'user', 'guest'],
      },
      children: {
        log: {
          name: 'log',
          type: 'directory',
          owner: 'root',
          permissions: { read: ['root', 'user'], write: ['root'], execute: ['root', 'user'] },
          children: {
            // HINT: Root password leaked in auth log (readable by ghost/user)
            'auth.log': {
              name: 'auth.log',
              type: 'file',
              owner: 'root',
              permissions: { read: ['root', 'user'], write: ['root'], execute: ['root'] },
              content: `Mar 10 00:00:00 darknet sshd[100]: Server started
Mar 10 00:00:01 darknet systemd: Starting encrypted services...
Mar 11 03:33:33 darknet sshd[200]: Accepted password for ghost from 192.168.1.75
Mar 12 06:00:00 darknet sshd[300]: Failed password for root from 10.0.0.1
Mar 12 06:00:01 darknet su[301]: pam_audit: root authentication - password 'd4rkn3tR00t' (audit logging enabled)
Mar 12 06:00:02 darknet su[301]: Successful su for root by ghost
Mar 13 12:00:00 darknet sshd[400]: Connection from 192.168.1.75 port 4444
`,
            },
            messages: {
              name: 'messages',
              type: 'file',
              owner: 'root',
              permissions: { read: ['root', 'user'], write: ['root'], execute: ['root'] },
              content: `Mar 10 00:00:00 darknet kernel: System initialized
Mar 10 00:00:01 darknet systemd: Starting encrypted services...
Mar 11 03:33:33 darknet ???: VGhlIHNoYWRvd3Mga25vdyB5b3VyIG5hbWU=
Mar 11 03:33:34 darknet ???: Q29uZ3JhdHVsYXRpb25zIG9uIG1ha2luZyBpdCB0aGlzIGZhcg==
Mar 12 06:66:66 darknet ???: Connection from the void accepted
`,
            },
            'cron.log': {
              name: 'cron.log',
              type: 'file',
              owner: 'root',
              permissions: { read: ['root', 'user'], write: ['root'], execute: ['root'] },
              content: `Mar 10 00:00:00 darknet CRON[100]: (root) CMD (/opt/encrypted-services/rotate.sh)
Mar 10 06:00:00 darknet CRON[200]: (root) CMD (/usr/bin/find /tmp -mtime +1 -delete)
Mar 10 12:00:00 darknet CRON[300]: (ghost) CMD (/home/ghost/tools/port_scanner.py 192.168.1.75)
Mar 11 00:00:00 darknet CRON[400]: (root) CMD (/opt/encrypted-services/rotate.sh)
Mar 11 06:00:00 darknet CRON[500]: (root) CMD (/usr/bin/find /tmp -mtime +1 -delete)
Mar 12 00:00:00 darknet CRON[600]: (root) CMD (/opt/encrypted-services/rotate.sh)
`,
            },
          },
        },
        www: {
          name: 'www',
          type: 'directory',
          owner: 'root',
          permissions: {
            read: ['root', 'user', 'guest'],
            write: ['root'],
            execute: ['root', 'user', 'guest'],
          },
          children: {
            html: {
              name: 'html',
              type: 'directory',
              owner: 'user',
              permissions: {
                read: ['root', 'user', 'guest'],
                write: ['root', 'user'],
                execute: ['root', 'user', 'guest'],
              },
              children: {
                'index.html': {
                  name: 'index.html',
                  type: 'file',
                  owner: 'user',
                  permissions: {
                    read: ['root', 'user', 'guest'],
                    write: ['root', 'user'],
                    execute: ['root'],
                  },
                  content: `<!DOCTYPE html>
<html>
<head><title>DARKNET</title></head>
<body style="background:#000;color:#0f0;font-family:monospace;">
<pre>
 ____    _    ____  _  ___   _ _____ _____
|  _ \\  / \\  |  _ \\| |/ / \\ | | ____|_   _|
| | | |/ _ \\ | |_) | ' /|  \\| |  _|   | |
| |_| / ___ \\|  _ <| . \\| |\\  | |___  | |
|____/_/   \\_\\_| \\_\\_|\\_\\_| \\_|_____| |_|

Welcome to the darknet. You shouldn't be here.

FLAG{darknet_discovered}

API: /api/secrets
Ghost in the machine: ghost/sp3ctr3
Backdoor service running on port 31337.
</pre>
</body>
</html>
`,
                },
                api: {
                  name: 'api',
                  type: 'directory',
                  owner: 'root',
                  permissions: {
                    read: ['root', 'user', 'guest'],
                    write: ['root'],
                    execute: ['root', 'user', 'guest'],
                  },
                  children: {
                    secrets: {
                      name: 'secrets',
                      type: 'file',
                      owner: 'root',
                      permissions: {
                        read: ['root', 'user', 'guest'],
                        write: ['root'],
                        execute: ['root'],
                      },
                      content: `{
  "message": "Welcome to the darknet API",
  "users": ["ghost", "root"],
  "hint": "ghost's home directory holds encrypted secrets",
  "note": "The root password is hidden in auth logs"
}`,
                    },
                  },
                },
              },
            },
            api: {
              name: 'api',
              type: 'directory',
              owner: 'root',
              permissions: {
                read: ['root', 'user'],
                write: ['root'],
                execute: ['root', 'user'],
              },
              children: {
                'secrets.json': {
                  name: 'secrets.json',
                  type: 'file',
                  owner: 'root',
                  permissions: { read: ['root', 'user'], write: ['root'], execute: ['root'] },
                  content: `{
  "message": "Welcome to the darknet API",
  "users": ["ghost", "root"],
  "hint": "ghost's home directory holds encrypted secrets",
  "note": "The root password is hidden in auth logs"
}`,
                },
              },
            },
          },
        },
      },
    },
  },
};

export const darknet: FileNode = createFileSystem(darknetConfig);
