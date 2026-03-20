# JSHACK.ME

A web-based JavaScript terminal emulator with a retro amber-on-black CRT aesthetic. Execute JavaScript expressions and custom commands in a terminal-like interface, featuring a virtual Unix-like file system and network simulation for a mission-based hacking game with procedurally generated contracts. Name your workstation, crack multiple WiFi networks to access different subnets, and take darknet contracts.

**Live Demo:** [jshack.me](https://jshack.me)

<p align="center">
  <img src="assets/demo.gif" alt="Terminal demo" width="600">
</p>

## The Challenge

You are **jshacker**, a freelance operator working from a personal workstation. Name your machine, boot up, and crack WiFi networks — each one gives access to a different subnet of machines to explore. When you're ready, browse the darknet marketplace for contracts and hack into procedurally generated networks to complete missions.

Each mission drops you into a unique network topology with routers, servers, and hidden flags. Use your knowledge of Linux commands, networking, and creative thinking to infiltrate targets and complete contracts.

Start with `help()` to see available commands. Good luck, hacker.

## Features

- **JavaScript Execution** - Run any JavaScript expression directly in the terminal
- **Command History** - Navigate previous commands with up/down arrows
- **Tab Autocompletion** - Complete commands and variables with Tab key
- **Variable Support** - Create variables with `const` and `let` declarations
- **Virtual Environment** - Explore a simulated system with secrets to uncover
- **Command Restrictions** - Commands are tiered by privilege level; escalate from guest to root to unlock tools
- **Intro & Boot Screen** - Name your workstation, start a new game with a Linux-style boot sequence
- **Multi-WiFi Networks** - Multiple seeded WiFi networks per game; each provides a different subnet of machines
- **WiFi Hacking Gate** - Crack WPA2 networks using aircrack-ng-style commands; switch networks anytime
- **Network Simulation** - Discover and hack into remote machines; per-WiFi subnets with routers, servers, and databases
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

35+ commands covering filesystem operations, networking, WiFi hacking, mission gameplay, and more. Use `help()` in the terminal to list commands or `man(cmd)` for detailed usage.

See [src/commands/README.md](src/commands/README.md) for the full command reference.

### Examples

```javascript
// Basic JavaScript
2 + 2; // => 4
Math.sqrt(16); // => 4

// Variables
const name = 'World';
echo('Hello ' + name); // => Hello World

// File system
ls(); // List current directory
cd('/etc'); // Change to /etc
cat('passwd'); // View file contents

// Help
man('ls'); // Show manual for ls command

// Switch user (will prompt for password)
su('root'); // Attempt to switch to root

// WiFi hacking (required before network access)
airmon('start', 'wlan0'); // Enable monitor mode
airdump(); // Scan for WiFi networks
aircrack('A4:CF:12:D3:8B:7A'); // Crack target network

// Network
ifconfig(); // Show network interfaces
whoami(); // Display current user
ping('localhost'); // Test connectivity

// SSH to remote machine
ssh('admin', '45.33.32.100'); // Connect to remote host
exit(); // Return to previous machine

// HTTP requests
curl('http://45.33.32.100/'); // Fetch web page
curl('45.33.32.100/status', '-i'); // Include headers

// Edit and execute files
nano('exploit.js'); // Opens nano-style editor
// (Type code, Ctrl+S to save, Ctrl+X to exit)
node('exploit.js'); // Execute the file

// FTP file transfer
ftp('45.33.32.100'); // Connect to remote FTP server
// In FTP mode:
ls(); // List remote files
get('secret.txt'); // Download to local
put('/tmp/data.txt'); // Upload to remote
quit(); // Exit FTP
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
npm run encode        # Generate encoded filesystems + secrets
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
├── session/                # SessionContext — global session state
├── filesystem/             # Virtual file system with IndexedDB persistence
├── network/                # Per-machine network simulation
├── hooks/                  # Custom React hooks
├── commands/               # Terminal commands (colocated with tests)
├── generation/             # Seeded mission network generator
├── theme/                  # Terminal color themes
├── utils/                  # Utilities (crypto, storage, network, content codec)
└── App.tsx                 # Root component
scripts/
└── encode.ts               # Pre-build: encodes filesystems + secrets (anti-cheat)
e2e/
└── mission-playthrough.spec.ts # Playwright E2E (mission playthroughs — all entry variants)
```

## SEO & Social Sharing

The site includes Open Graph and Twitter Card meta tags for rich social media previews when sharing the URL. The OG image features the CRT terminal aesthetic with a simulated network scan.

To regenerate the OG image after edits to `public/og-image.html`:

```bash
npx playwright screenshot --viewport-size="1200,630" --full-page public/og-image.html public/og-image.png
```

## Documentation

- **[WIP.md](WIP.md)** — Work-in-progress log: session-by-session implementation history, current status, and future ideas
- **[LEARNINGS.md](LEARNINGS.md)** — Gotchas, patterns that worked, architectural decisions, and testing insights

## Deployment

The project is configured for Vercel deployment. Push to the `main` branch to trigger automatic deployment.

## License

MIT
