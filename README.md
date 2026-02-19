# JSHACK.ME

A web-based JavaScript terminal emulator with a retro amber-on-black CRT aesthetic. Execute JavaScript expressions and custom commands in a terminal-like interface, featuring a virtual Unix-like file system and network simulation for CTF-style hacking puzzles.

**Live Demo:** [jshack.me](https://jshack.me)

<p align="center">
  <img src="assets/demo.gif" alt="CTF playthrough demo" width="600">
</p>

## The Challenge

You start as a regular user on a machine connected to a network. Hidden throughout the system are **flags** - secret strings in the format `FLAG{...}` that prove you've successfully completed a challenge.

Your mission:

- **Explore** the local file system for clues
- **Escalate privileges** to access restricted areas
- **Discover** other machines on the network
- **Hack** your way into remote systems
- **Find all the flags**

Some flags are hidden in plain sight. Others require cracking passwords, exploiting misconfigurations, or pivoting through multiple machines. Use your knowledge of Linux commands, networking, and creative thinking to uncover them all.

Start with `help()` to see available commands. Good luck, hacker.

## Features

- **JavaScript Execution** - Run any JavaScript expression directly in the terminal
- **Command History** - Navigate previous commands with up/down arrows
- **Tab Autocompletion** - Complete commands and variables with Tab key
- **Variable Support** - Create variables with `const` and `let` declarations
- **Virtual Environment** - Explore a simulated system with secrets to uncover
- **Command Restrictions** - Commands are tiered by privilege level; escalate from guest to root to unlock tools
- **WiFi Hacking Gate** - Crack a WiFi network using aircrack-ng-style commands before accessing the network
- **Network Simulation** - Discover and hack into remote machines
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

| Command                 | Description                                                    |
| ----------------------- | -------------------------------------------------------------- |
| `help()`                | List all available commands                                    |
| `man(cmd)`              | Display detailed manual for a command                          |
| `echo(value)`           | Output a stringified value                                     |
| `author()`              | Display author profile card                                    |
| `clear()`               | Clear the terminal screen                                      |
| `pwd()`                 | Print current working directory                                |
| `ls([path], [flags])`   | List directory contents (-a for hidden files)                  |
| `cd([path])`            | Change current directory                                       |
| `cat(path)`             | Display file contents                                          |
| `su(user)`              | Switch user (prompts for password)                             |
| `whoami()`              | Display current username                                       |
| `airmon(action, iface)` | Enable/disable wireless monitor mode                           |
| `airdump()`             | Scan for nearby wireless networks                              |
| `aircrack(bssid)`       | Crack WPA/WPA2 wireless network key                            |
| `ifconfig([iface])`     | Display network interface configuration                        |
| `ping(host, [count])`   | Test connectivity to a network host                            |
| `nmap(target)`          | Scan for open ports or discover hosts in a range               |
| `nslookup(domain)`      | Query DNS to resolve domain to IP address                      |
| `ssh(user, host)`       | Connect to remote machine via SSH                              |
| `exit()`                | Close SSH connection and return to previous machine            |
| `ftp(host)`             | Connect to remote machine via FTP                              |
| `curl(url, [flags])`    | Fetch web content via HTTP (supports -i for headers, -X POST)  |
| `nc(host, port)`        | Connect to arbitrary port (interactive for special services)   |
| `decrypt(file, key)`    | Decrypt file using AES-256-GCM                                 |
| `output(cmd, [file])`   | Capture command output to variable or file                     |
| `resolve(promise)`      | Unwrap a Promise and display its value                         |
| `strings(file, [min])`  | Extract printable strings from binary files                    |
| `nano(path)`            | Open file in nano-style text editor (Ctrl+S save, Ctrl+X exit) |
| `node(path)`            | Execute a JavaScript file (requires execute permission)        |
| `theme([name])`         | List themes or switch terminal color theme                     |
| `reset(["confirm"])`    | Reset game to factory defaults (clears all saved progress)     |

### FTP Mode Commands

When connected via FTP, a dedicated command set is available:

| Command                | Description                                          |
| ---------------------- | ---------------------------------------------------- |
| `pwd()`                | Print remote working directory                       |
| `lpwd()`               | Print local working directory                        |
| `cd(path)`             | Change remote directory                              |
| `lcd(path)`            | Change local directory                               |
| `ls([path], [flags])`  | List remote directory contents (-a for hidden files) |
| `lls([path], [flags])` | List local directory contents (-a for hidden files)  |
| `get(file, [dest])`    | Download file from remote to local                   |
| `put(file, [dest])`    | Upload file from local to remote                     |
| `quit()` / `bye()`     | Close FTP connection                                 |

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
ssh('admin', '192.168.1.1'); // Connect to gateway
exit(); // Return to previous machine

// HTTP requests
curl('http://webserver.local/'); // Fetch web page
curl('webserver.local/config.php', '-i'); // Include headers
curl('webserver.local/api/users', '-X POST'); // POST to API

// Edit and execute files
nano('exploit.js'); // Opens nano-style editor
// (Type code, Ctrl+S to save, Ctrl+X to exit)
node('exploit.js'); // Execute the file

// FTP file transfer
ftp('192.168.1.50'); // Connect to fileserver
// In FTP mode:
ls(); // List remote files
get('secret.txt'); // Download to local
put('/tmp/data.txt'); // Upload to remote
quit(); // Exit FTP
```

## Network Simulation

Your machine has a wireless interface but it starts disconnected. Before you can reach the network, you'll need to crack a WiFi access point using the aircrack-ng-inspired command suite (`airmon`, `airdump`, `aircrack`).

Once connected, you're on a local network with other machines running different services and hiding their own secrets.

Use network reconnaissance commands to:

- Crack WiFi to gain network access
- Discover your network configuration
- Find other machines on the network
- Identify running services and open ports
- Connect to remote systems
- Pivot through machines to reach hidden networks

Each machine has its own network view - interfaces, reachable hosts, and DNS change based on where you are. The deeper you go, the more you discover.

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
npm run test:e2e      # Run Playwright E2E test (full CTF playthrough)
```

### Test Coverage

872 unit tests across 60 colocated test files covering terminal commands, hooks, components, utilities, filesystem, persistence, and procedural generation.

1 Playwright E2E test that plays through the entire CTF game (all 16 flags) in a real browser — serves as both a comprehensive regression test and a visual demo. Run with `--headed` to watch it play:

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
└── ctf-playthrough.spec.ts # Playwright E2E test (full 16-flag playthrough)
```

## SEO & Social Sharing

The site includes Open Graph and Twitter Card meta tags for rich social media previews when sharing the URL. The OG image features the CRT terminal aesthetic with a simulated network scan.

To regenerate the OG image after edits to `public/og-image.html`:

```bash
npx playwright screenshot --viewport-size="1200,630" --full-page public/og-image.html public/og-image.png
```

## Documentation

- **[WIP.md](WIP.md)** — Work-in-progress log: session-by-session implementation history and current status
- **[PLAN.md](PLAN.md)** — Feature roadmap and acceptance criteria
- **[LEARNINGS.md](LEARNINGS.md)** — Gotchas, patterns that worked, architectural decisions, and testing insights
- **[docs/archive/](docs/archive/)** — Archived CTF design docs (16-flag tutorial is finalized)

## Deployment

The project is configured for Vercel deployment. Push to the `main` branch to trigger automatic deployment.

## License

MIT
