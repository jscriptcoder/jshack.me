# JSHACK.ME

A web-based Linux-style terminal emulator with a retro amber-on-black CRT aesthetic. Type real shell-style commands (`nmap 10.10.10.10 -sV`, `cat /etc/passwd | grep root > out.txt`) in a terminal-like interface, featuring a virtual Unix filesystem and network simulation for a mission-based hacking game with procedurally generated contracts. Choose your username, name your workstation, set your root password, crack multiple WiFi networks to access different subnets, and take darknet contracts. Scripts (`.js` files) still use JavaScript for more advanced automation.

**Live Demo:** [jshack.me](https://jshack.me)

<p align="center">
  <img src="assets/demo.gif" alt="Terminal demo" width="600">
</p>

## The Challenge

You are a freelance operator working from a personal workstation. Choose your username, name your machine, set your root password, boot up, and crack WiFi networks — each one gives access to a different subnet of machines to explore. When you're ready, browse the darknet marketplace for contracts and hack into procedurally generated networks to complete missions.

Each mission drops you into a unique network topology with routers, servers, and hidden flags. Use your knowledge of Linux commands, networking, and creative thinking to infiltrate targets and complete contracts.

Start with `help` to see available commands. Good luck, hacker.

## Features

- **Shell-style Input** - Real Linux syntax: `nmap 10.10.10.10 -sV`, pipes (`cat file | grep x`), redirect (`ls > out.txt`), quoted args, flags
- **Scripting via `node`** - Save `.js` files and execute them; scripts use JavaScript with command function calls (`nmap('1.2.3.4')`) for automation
- **Command History** - Navigate previous commands with up/down arrows
- **Tab Autocompletion** - Tokenizer-aware completion for commands, paths, flags, and subcommand keywords
- **Virtual Environment** - Explore a simulated system with secrets to uncover
- **Command Restrictions** - Commands are tiered by privilege level; escalate from guest to root to unlock tools
- **Intro & Boot Screen** - Choose your username, name your workstation, set your root password, start a new game with a Linux-style boot sequence
- **Multi-WiFi Networks** - Multiple seeded WiFi networks per game; each provides a different subnet of machines
- **WiFi Hacking Gate** - Crack WPA2 networks using aircrack-ng-style commands; switch networks anytime
- **Network Simulation** - Discover and hack into remote machines; per-WiFi subnets with routers, servers, and databases
- **DNS Zone Transfers** - DNS servers with BIND zone files; use `dig` for lookups and AXFR zone transfers to discover machines
- **Redis Service** - ~35% of database machines run Redis on port 6379; connect via `rediscli`, query key-value data, brute-force passwords with `hydra`
- **Defense Treadmill** - Patch vulnerable services with `apt upgrade`. CVEs publish over real game time (~one new CVE every 13 hours across the network). Patching buys breathing room; neglecting it means re-exploitation
- **Router Firmware** - Routers have vendor-stamped firmware (Cisco, MikroTik, DD-WRT, OpenWRT, pfSense, EdgeOS) that treadmills alongside services. Exploitable via `msfconsole`, patchable via `apt upgrade firmware`
- **Typed Exploit Effects** - Each CVE produces one of 8 outcomes: full shell (tiered), restricted shell, file read, directory listing, file write, password reset, backdoor port, or script execution. The effect depends on the service being exploited
- **Version Pinning** - `apt install http=Apache/2.4.49` pins a service to a specific version. Works for both services and router firmware. Deliberate downgrades allowed
- **Connection Logging** - SSH, FTP, SCP, su, Redis, HTTP, msfconsole exploits, nc connects, and nmap scans are logged to target machine log files in realistic Linux formats (`auth.log`, `vsftpd.log`, `redis.log`, `access.log`, `syslog`)
- **SSH Key Persistence** - After first successful SSH/SCP login, the key is saved; subsequent connections auto-authenticate
- **Multi-Tab Support** - Open multiple browser tabs as independent terminals with shared filesystem, WiFi, mission, and theme state
- **Session Persistence** - Your location and files are saved; return where you left off after refresh
- **SEO & Social Sharing** - Open Graph and Twitter Card meta tags for rich link previews
- **Anti-Cheat** - Filesystem content and secrets encoded at build time; flags and passwords can't be found by searching the JS bundle
- **Color Themes** - 4 persistent terminal themes (amber, green, cyan, light) via `theme()` command
- **Retro CRT Theme** - Classic amber-on-black terminal aesthetic (default)

## Tech Stack

- **React 19** + **TypeScript**
- **Vite** - Build tool and dev server
- **Tailwind CSS v4** - Styling
- **Prettier** - Code formatting
- **Vitest** + **React Testing Library** - Unit testing
- **Playwright** - E2E testing

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/jscriptcoder/jshack.me.git
cd jshack.me

# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Available Commands

35+ commands covering filesystem operations, networking, WiFi hacking, mission gameplay, and more. Use `help` in the terminal to list commands or `man <cmd>` for detailed usage.

See [src/commands/README.md](src/commands/README.md) for the full command reference.

### Examples (interactive shell)

```bash
# File system
ls                          # List current directory
cd /etc                     # Change to /etc
cat passwd                  # View file contents
cat /etc/passwd | grep root # Pipe to filter
echo hello > greeting.txt   # Redirect output to a file

# Help
man ls                      # Show manual for ls command

# Switch user (will prompt for password)
su root                     # Attempt to switch to root

# WiFi hacking (required before network access)
airmon start wlan0          # Enable monitor mode
airdump                     # Scan for WiFi networks
aircrack A4:CF:12:D3:8B:7A  # Crack target network

# Network
ifconfig                    # Show network interfaces
whoami                      # Display current user
ping localhost              # Test connectivity

# SSH to remote machine
ssh admin@45.33.32.100      # Connect to remote host
exit                        # Return to previous machine (or previous user after su)

# HTTP requests
curl http://45.33.32.100/          # Fetch web page
curl -i 45.33.32.100/status        # Include headers
curl -X POST 45.33.32.100/api/x    # POST request

# Edit and execute files
nano exploit.js             # Opens nano-style editor (Ctrl+S save, Ctrl+X exit)
node exploit.js             # Execute a JavaScript file

# FTP file transfer
ftp 45.33.32.100            # Connect to remote FTP server
# In FTP mode: ls, get secret.txt, put /tmp/data.txt, quit

# Exploit a vulnerable service (effect depends on the CVE)
msfconsole 10.0.0.5 80                                    # Shell / auth bypass / ...
msfconsole 10.0.0.5 21 /etc/passwd                        # file_read: dump a target file
msfconsole 10.0.0.5 21 /root/shell.php:/var/www/html/s.php # file_write: upload
msfconsole 10.0.0.5 6379 /root/payloads/dump.js           # script_exec: run a script

# Patch vulnerable services
apt upgrade                      # Upgrade all vulnerable services + firmware
apt upgrade http                 # Upgrade only the http service
apt upgrade firmware             # Upgrade only router firmware
apt install http=Apache/2.4.60   # Pin a specific version
```

### Scripting (`.js` files, executed via `node`)

Scripts use JavaScript with command functions for more advanced automation:

```javascript
// Basic JavaScript expressions still work in scripts
const name = 'World';
echo('Hello ' + name);

// Command functions mirror shell invocations
const hosts = nmap('10.0.0.1-254');
echo(hosts);

// Awaiting an async command resolves to the lines it streamed
const lines = await ping('10.0.0.5', 3);
echo('got ' + lines.length + ' reply lines');

// Write content to a file via the script-only writeFile() helper
writeFile('/tmp/ping.log', lines); // arrays of strings are joined with '\n'
writeFile('/tmp/backup.txt', cat('/etc/passwd'));
```

## Network Simulation

Your machine has a wireless interface but it starts disconnected. Before you can reach the network, you'll need to crack a WiFi access point using the aircrack-ng-inspired command suite (`airmon`, `airdump`, `aircrack`).

Once connected, you can install hacking tools (`apt('install', 'nmap')`, etc.), browse the darknet marketplace for contracts, and accept missions. Each mission generates a unique network with routers, servers, and targets to infiltrate.

Use network reconnaissance commands to:

- Crack WiFi to gain network access and enable `apt install`
- Discover your network configuration
- Find other machines on the network
- Identify running services and open ports
- Connect to remote systems

Each machine has its own network view - interfaces, reachable hosts, and DNS change based on where you are.

## Development

```bash
npm run dev           # Start development server (auto-encodes first)
npm run build         # Production build (auto-encodes first)
npm run encode        # Generate encoded secrets
npm run lint          # Run ESLint
npm run format        # Format code with Prettier
npm run format:check  # Check formatting (CI)
npm run preview       # Preview production build
npm test              # Run tests in watch mode
npm run test:run      # Run tests once
npm run test:coverage # Run tests with coverage
npm run test:e2e      # Run Playwright E2E tests (mission playthroughs)
```

### Test Coverage

Unit tests covering terminal commands, hooks, components, utilities, filesystem, persistence, procedural generation, and mission system.

Playwright E2E tests: mission playthroughs covering SSH, FTP, NC entry variants + mission lifecycle. Run with `--headed` to watch them play:

```bash
npx playwright test --headed
```

## Project Structure

```
src/
├── components/Terminal/    # Terminal UI components
├── session/                # SessionContext, gameTime — global session + game clock
├── filesystem/             # Virtual file system with IndexedDB persistence
├── network/                # Per-machine network simulation, version overlays, types
├── hooks/                  # Custom React hooks (command wiring, authentication)
├── logging/                # Connection logging (auth.log, vsftpd.log, access.log, syslog)
├── commands/               # Terminal commands (colocated with tests)
├── generation/             # Seeded network generator + vulnerability system
│   ├── pools/              # Static data: CVE templates, service/firmware templates
│   └── timeline/           # Procedural version walker, effect picker, CVE builder
├── theme/                  # Terminal color themes
├── utils/                  # Utilities (crypto, storage, network, content codec)
└── App.tsx                 # Root component
scripts/
└── encode.ts               # Pre-build: encodes secrets (anti-cheat)
e2e/
└── mission-playthrough.spec.ts # Playwright E2E (mission playthroughs — all entry variants)
```

## SEO & Social Sharing

The site includes Open Graph and Twitter Card meta tags for rich social media previews when sharing the URL. The OG image features the CRT terminal aesthetic with a simulated network scan.

To regenerate the OG image after edits to `public/og-image.html`:

```bash
npx playwright screenshot --viewport-size="1200,630" --full-page public/og-image.html public/og-image.png
```

## Deployment

The project is configured for Vercel deployment. Push to the `main` branch to trigger automatic deployment.

## License

MIT
