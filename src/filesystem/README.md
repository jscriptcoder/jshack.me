# Filesystem

Virtual Unix-like filesystem for the hacking terminal. Each machine (localhost and remotes) has its own independent filesystem with unique content, users, and permissions.

## Files

| File                    | Description                                                                                                                                                                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`              | Core types: `FileNode`, `FilePermissions`, `FileSystemPatch`                                                                                                                                                                                                            |
| `fileSystemFactory.ts`  | `createFileSystem(config)` — generates a standard directory tree (`/root`, `/home`, `/etc`, `/var`, `/tmp`, `/boot`, `/bin`, `/usr/bin`) from a `MachineFileSystemConfig`. Uses `mergeExtraDirectories()` to safely merge `extraDirectories` with factory-created dirs. |
| `machineFileSystems.ts` | Thin assembly — imports from `machines/`, exports `machineFileSystems` Record, `MachineId` type, and `getDefaultHomePath`. Gateway filesystem defined inline with `/bin/` (system utilities) and empty `/usr/bin/`.                                                     |
| `machines/`             | Per-machine filesystem definitions: `localhost.ts`, `fileserver.ts`, `webserver.ts` (each exports a `FileNode`). Localhost includes `/bin/` (system utilities) and `/usr/bin/` (apt-installable tools) via binary stubs.                                                |
| `fileSystemUtils.ts`    | Pure utility functions: path resolution (`normalizePath`, `resolvePath`), immutable tree operations (`getNodeAtPath`, `updateNodeAtPath`, `addChildAtPath`, `removeChildAtPath`), patch helpers (`upsertPatch`, `applyPatches`, `isValidPatch`)                         |
| `FileSystemContext.tsx` | React context provider wiring `fileSystemUtils` with React state, IndexedDB persistence, and cross-tab sync                                                                                                                                                             |
| `index.ts`              | Module exports                                                                                                                                                                                                                                                          |

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
- `/boot` — kernel and bootloader files (`vmlinuz`, `initrd.img`)
- `/bin` — system utility binaries from `binContent`
- `/usr/bin` — apt-installable tool binaries from `usrBinContent`
- Extra directories via `extraDirectories` (merged one-level-deep with `mergeExtraDirectories()`)

### Machines

| Machine    | IP            | Key Content                                                                 |
| ---------- | ------------- | --------------------------------------------------------------------------- |
| localhost  | 192.168.1.100 | Starting machine, all tools pre-installed in `/bin/` and `/usr/bin/`        |
| gateway    | 192.168.1.1   | Static border router, system utilities in `/bin/`, empty `/usr/bin/`        |
| fileserver | 192.168.1.50  | FTP/SSH file server (ports 21, 22), `/srv/ftp/` content tree                |
| webserver  | 192.168.1.75  | Web server with NC backdoor (ports 22, 80, 3306, 4444), `/var/www/` content |

### Mission Filesystem Integration

`FileSystemProvider` accepts an optional `missionFileSystems` prop. When a mission is active, mission machine filesystems are merged into state alongside static machines. When the mission ends, they're removed. `MachineId` is typed as `string` to accommodate both static IPs and dynamically generated mission IPs.

### Persistence

User-created/modified files are persisted as patches in IndexedDB (`jshack-db` database, `filesystem` store). On init, patches are replayed on top of the base filesystem. Only the diff is stored — clearing the database resets to factory state. Both static and mission filesystem patches are persisted. On reload with an active mission, the mission is regenerated from its seed and mission patches are replayed on top. Mission patches are cleaned up on mission end/transition.

### Permission System

Each `FileNode` has read/write/execute permission arrays per user type (`root`, `user`, `guest`). Root has access to everything. Commands like `cat`, `ls`, `cd` check read permissions. The `node()` command additionally checks execute permission. `ls -l` displays permissions in Unix `drwxrwxrwx` format where triples represent owner/user/guest.

**Default permissions for new files**: Files created by users (via `nano`, `createFile`, or patches without explicit permissions) default to `execute: ['root']` only — matching Unix umask behavior where new files are not executable. Editing existing files preserves their original permissions. The `chmod` command is needed to add execute permission.

### Permission Patches

`FileSystemPatch` supports an optional `permissions` field. When present, `applyPatches` uses the explicit permissions instead of inferring from owner. This enables:

- **Permission preservation**: `writeFile` includes the existing file's permissions in the patch, so edits don't lose execute bits or custom permissions.
- **Permission transfer**: `scp` copies files with source permissions preserved via the patch.
- **Permission modification**: `chmod` creates patches with updated permission arrays.
