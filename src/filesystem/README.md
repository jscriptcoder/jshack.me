# Filesystem

Virtual Unix-like filesystem for the hacking terminal. Each machine (localhost and remotes) has its own independent filesystem with unique content, users, and permissions.

## Files

| File                    | Description                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`              | Core types: `FileNode`, `FilePermissions`, `FileSystemPatch`                                                                                                                    |
| `fileSystemFactory.ts`  | `createFileSystem(config)` — generates a standard directory tree (`/root`, `/home`, `/etc`, `/var`, `/tmp`) from a `MachineFileSystemConfig`                                    |
| `machineFileSystems.ts` | Thin assembly — imports from `machines/`, exports `machineFileSystems` Record, `MachineId` type, and `getDefaultHomePath`                                                       |
| `machines/`             | Per-machine filesystem definitions: `localhost.ts`, `gateway.ts`, `fileserver.ts`, `webserver.ts`, `darknet.ts`, `shadow.ts`, `void.ts`, `abyss.ts` (each exports a `FileNode`) |
| `FileSystemContext.tsx` | React context providing filesystem operations: `resolvePath`, `getNode`, `readFile`, `writeFile`, `readFileFromMachine`, plus persistence via IndexedDB patches                 |
| `index.ts`              | Module exports                                                                                                                                                                  |

## Architecture

### FileNode Tree

Every file and directory is a `FileNode`:

```typescript
type FileNode = {
  readonly name: string;
  readonly type: 'file' | 'directory';
  readonly owner: UserType; // 'root' | 'user' | 'guest'
  readonly permissions: FilePermissions; // read, write, execute arrays
  readonly content?: string; // file content (files only)
  readonly children?: Record<string, FileNode>; // subdirectories/files
};
```

### Factory Pattern

`createFileSystem(config)` builds a standard Unix tree from a config object:

- `/root` — root home with optional custom content
- `/home/{user}` — auto-generated home dirs for non-root users
- `/etc/passwd` — auto-generated from user list (MD5 hashes)
- `/var/log` — log files from `varLogContent`
- `/tmp` — world-writable temp directory
- Extra directories via `extraDirectories` (e.g., `/var/www`, `/srv/ftp`)

### Machines

| Machine    | IP            | Key Content                                                                    |
| ---------- | ------------- | ------------------------------------------------------------------------------ |
| localhost  | 192.168.1.100 | Starting machine, encrypted files, keyfile                                     |
| gateway    | 192.168.1.1   | Router config backups, web admin panel, dual-interface (WAN + LAN)             |
| fileserver | 192.168.1.50  | FTP directories (`/srv/ftp`), hidden backups                                   |
| webserver  | 192.168.1.75  | Web content (`/var/www`), API endpoints, backdoored binary                     |
| darknet    | 203.0.113.42  | Darknet web content, API secrets, final flag, dual-interface (public + hidden) |
| shadow     | 10.66.66.1    | Monitoring node — Flag 14 debug challenge, FTP exports, diagnostics scripts    |
| void       | 10.66.66.2    | Hidden network skeleton — dbadmin, root, guest                                 |
| abyss      | 10.66.66.3    | Hidden network skeleton — phantom, root, guest                                 |

### Mission Filesystem Integration

`FileSystemProvider` accepts an optional `missionFileSystems` prop. When a mission is active, mission machine filesystems are merged into state alongside the static tutorial machines. When the mission ends, they're removed. `MachineId` is typed as `string` to accommodate both static IPs and dynamically generated mission IPs.

### Persistence

User-created/modified files are persisted as patches in IndexedDB (`jshack-db` database, `filesystem` store). On init, patches are replayed on top of the base filesystem. Only the diff is stored — clearing the database resets to factory state. Mission filesystem patches are excluded from persistence — only patches for the 8 static tutorial machines are saved to IndexedDB.

### Permission System

Each `FileNode` has read/write/execute permission arrays per user type (`root`, `user`, `guest`). Root has access to everything. Commands like `cat`, `ls`, `cd` check read permissions. The `node()` command additionally checks execute permission — directories and scripts have execute matching read, while data files are execute-restricted to root only.
