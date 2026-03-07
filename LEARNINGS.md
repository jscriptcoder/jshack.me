# Learnings: Dynamic Network Access & Iptables

## Decisions Made

### Iptables rule format — simplified

- **Options considered**: (A) Real iptables-restore format; (B) `forward <port> to <ip>:<port>` keyword format; (C) Arrow format `port -> ip:port`; (D) `DNAT tcp port -> ip:port`
- **Decision**: Option B — `forward <port> to <ip>:<port>`
- **Rationale**: Self-documenting, easy to parse, still feels like a config file. Real iptables format is too cryptic for a game. File lives at `/etc/iptables/rules.v4` for realism.
- **Trade-offs**: Less realistic than real iptables, but the gameplay value outweighs authenticity.

### Iptables auto-apply on save (no reload command)

- **Options considered**: (A) `nano` + `iptables-restore` command; (B) `iptables` command with flags; (C) Auto-apply on nano save
- **Decision**: Option C — changes auto-apply when the file is saved
- **Rationale**: Adding a separate reload command is significant complexity for little gameplay value. On-demand parsing (read file at connection/scan time) achieves the same effect with no save hooks needed.

### Per-machine credential hints — deferred

- **Context**: With credential-based attack chains removed, how do players discover SSH credentials for internal machines?
- **Decision**: Defer — don't add per-machine credential hints for now
- **Rationale**: Only a problem when accessing as guest (can't read /etc/passwd). If this becomes an issue in practice, we'll address it then. Avoids re-introducing the complexity we just removed.
