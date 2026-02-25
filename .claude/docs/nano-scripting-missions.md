# Nano + Scripting Mission Concepts

Mission designs that require the player to use `nano` (edit/create files) and `node` (execute JS) as core gameplay mechanics. These go beyond the existing exfiltrate/tamper/credential*theft objectives by making the player \_write or fix code* on the target machine.

## Status: Brainstorm — not yet implemented

---

## Existing Capabilities

- `nano(path)` — create and edit files in the virtual filesystem
- `node(path)` — execute JS files with full command access (cat, ls, ssh, etc.)
- `strings(path)` — extract readable text from binary files
- `decrypt(file, key)` — XOR decrypt with a known key

These missions would leverage `nano` + `node` together — the player must write or modify a script, then run it to progress.

---

## Concept 1: Custom Cipher Decode

The target file is encoded with a non-standard cipher that `decrypt` can't handle. The player finds a hint describing the algorithm and must write a decode script.

**Flow:**

1. Find encoded target file on the target machine
2. Discover a hint file (README, comment in config, man page) describing the encoding
3. Write a JS script with `nano` that implements the decode
4. Run with `node` to reveal the ACCESS-KEY or password

**Cipher ideas:**

- Rotation cipher with variable key (Caesar with a twist)
- Custom base encoding (base-N with non-standard alphabet)
- Character substitution map (found in another file)
- XOR with a key derived from another file's contents (multi-step)

**Hint placement:** `/home/<user>/README.md`, `/etc/motd`, comments in the encoded file itself

**Pros:** Clean puzzle, self-contained, feels like cryptanalysis
**Cons:** Could feel like a LeetCode problem if narrative context is weak

---

## Concept 2: Log Parser / Data Extraction

A massive log file (hundreds of lines) contains the ACCESS-KEY fragmented across specific entries. A hint describes the extraction pattern. Too tedious to do manually — requires a script.

**Flow:**

1. Find a large log file (200-500 lines of realistic log entries)
2. Find a hint: "the key is in every Nth failed login attempt, read the 3rd field"
3. Write a parsing script with `nano`
4. Run with `node` to extract and assemble the key

**Pattern ideas:**

- Every Nth line matching a pattern, concatenate a specific field
- Lines with a specific error code, take the first character of each
- Timestamp-filtered entries, extract hex values from the message
- Entries from a specific IP, base64-decode the payload field

**Pros:** Feels realistic (real pentesting involves parsing logs), scalable difficulty
**Cons:** Need to generate convincing large logs procedurally

---

## Concept 3: Brute Force a PIN / Token

A service or locked file requires a numeric PIN or token. The player finds partial constraints and must write a brute-force script to generate valid candidates.

**Flow:**

1. Discover a locked resource (encrypted file, service prompt, access control)
2. Find constraints: "4-digit PIN, divisible by 7, digits sum to 13"
3. Write a brute-force script with `nano`
4. Run with `node` to find the valid PIN
5. Use the PIN to unlock the resource

**Constraint ideas:**

- Numeric: divisibility, digit sum, ascending/descending digits
- String: must match a regex pattern, specific character positions known
- Checksum: CRC or hash prefix must match a known value

**Pros:** Fun puzzle, feels like hacking, satisfying solve moment
**Cons:** Needs a new mechanism to "submit" or use the PIN (new command or file-based)

---

## Concept 4: Config Generator / Exploit Payload

The player must craft a file in a specific format to bypass a validation check. A template exists but requires computed values (e.g., a checksum that must match the content).

**Flow:**

1. Find a validation script or service that checks a config/payload format
2. Find the format spec (template file, error messages, partial docs)
3. Write a generator script that produces a valid file with `nano`
4. Run with `node` to generate, then submit the crafted file

**Payload ideas:**

- Config file with a checksum/hash field that must match the body
- JSON payload where specific fields must satisfy mathematical relationships
- Auth token with a computed signature (simple HMAC-like)

**Pros:** Most "hacker" feeling, closest to real exploit development
**Cons:** Complex to implement verification, might be confusing

---

## Concept 5: Fragmented Key Assembly

The key is split across multiple machines in different formats. The player collects fragments and writes a script to reassemble them.

**Flow:**

1. Find fragment A on machine 1 (hex-encoded)
2. Find fragment B on machine 2 (base64-encoded)
3. Find fragment C on machine 3 (reversed)
4. Find assembly instructions (order, transforms)
5. Write an assembly script with `nano` on any machine
6. Run with `node` to produce the final key

**Fragment format ideas:**

- Hex, base64, reversed, ROT13, binary string
- Interleaved (take every other character)
- XOR'd with a value found on yet another machine

**Pros:** Combines exploration + scripting, works well with multi-hop hard missions
**Cons:** Could be frustrating if assembly rules aren't clear; many moving pieces

---

## Concept 6: Debug a Broken Script

The player finds an existing script on the target machine that _almost_ works. Running it produces an error or wrong output. The player must fix it with `nano` and re-run to reveal critical data.

**Flow:**

1. Discover a script on the target machine (sysadmin utility, cron job, data export tool)
2. Run it with `node` — it errors or outputs garbage
3. Read the code, understand the intent, identify the bug
4. Fix with `nano`, re-run with `node`
5. Correct output reveals the ACCESS-KEY, password, or next-hop credentials

**Bug variety by difficulty:**

| Bug Type             | Example                                                                               | Difficulty  |
| -------------------- | ------------------------------------------------------------------------------------- | ----------- |
| Wrong file path      | Reads `/var/data/export.csv` but file is at `/var/data/exports.csv`                   | Easy        |
| Syntax error         | Missing bracket, unterminated string                                                  | Easy        |
| Wrong variable       | Uses `key` instead of `secret` from parsed config                                     | Medium      |
| Logic error          | Loop off-by-one, skips first/last entry                                               | Medium      |
| Incomplete algorithm | Decode function has right approach but wrong step (missing `.reverse()`)              | Medium-Hard |
| Missing piece        | Script references an env var or file path the player must find elsewhere and hardcode | Hard        |

**Narrative hooks:**

- Sysadmin's personal decrypt utility left on the server
- Automated backup script that broke after a config change
- Developer's debug tool that was never finished
- Monitoring script that accidentally logs sensitive data when fixed

**Pros:** Lowest barrier (edit, don't write from scratch), realistic, narrative-rich, graduated difficulty
**Cons:** Generated scripts must be readable and have believable bugs

---

## Combining Concepts in a Single Mission

These concepts are composable. A single hard mission could chain multiple:

1. **Find a broken script** on machine A (concept 6) — fix it, run it, reveals a partial key
2. **Parse a log file** on machine B (concept 2) — extract the second fragment
3. **Assemble fragments** (concept 5) — write a combiner script to produce the final key

Or a simpler medium mission:

1. **Find an encoded file** and the cipher description (concept 1)
2. **Write a decoder** with `nano`, run with `node` to get the ACCESS-KEY

---

## Implementation Considerations

### Generator Integration

- New objective type (e.g., `scripted_exfiltrate`) or variant of existing `exfiltrate`
- Script templates in `pools.ts` with placeholder bugs/encodings filled by PRNG
- Hint placement follows existing credential hint patterns
- Difficulty tier maps to bug complexity / number of steps

### What `node` Might Need

Currently `node(path)` executes JS with all commands in scope. For scripting missions, consider:

- File reading API: `cat(path)` already works inside `node`, but a `readLines(path)` returning an array would help
- Output capture: `console.log` works, but a way to write results to a file would be useful
- These could be natural extensions without special-casing for missions

### Difficulty Calibration

- **Easy:** Debug a broken script (concept 6, simple bug)
- **Medium:** Write a decoder from clear instructions (concept 1) or fix + find missing piece (concept 6, hard variant)
- **Hard:** Multi-step chain combining 2-3 concepts

### Seed Keywords

Potential keyword: `scripting` or `nano` to force a scripting mission variant.

### Hint Quality

The make-or-break factor. Hints must be:

- Clear enough that the player knows _what_ to do
- Vague enough that they still need to figure out _how_
- Discoverable through normal exploration (not hidden behind obscure paths)

---

## Open Questions

- Should scripting be a new objective type or a modifier on existing types?
- How many script templates are needed for variety? (Minimum viable: 3-5)
- Should the generated scripts use realistic JS or simplified pseudo-code style?
- Can we validate the player's fix programmatically, or is it purely "run and check output"?
- Should there be a fallback for players who don't know JS? (Hints that are very explicit?)
