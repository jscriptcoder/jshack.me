# CTF Flag Ideas: nano + node

Brainstormed ideas for new flags that leverage the `nano` (file editor) and `node` (JS execution) commands. These require the player to **write and execute JavaScript** — unique to the JSHACK.ME CTF.

---

## Idea 1: Write-and-Execute Challenge ✅ PLANNED — Flag 14 (shadow)

**Concept**: Player finds a broken/incomplete `.js` script on a machine. They must `nano` it to fix the bug, then `node` it to reveal the flag.

**Example setup**:

- File: `/home/user/decrypt_flag.js` — has a subtle bug (off-by-one, wrong variable, missing line)
- Running it as-is produces an error or wrong output
- Fixing the code and running it outputs the flag

**Skills**: nano, node, JavaScript debugging

---

## Idea 2: Code the Decoder (Favorite) ✅ IMPLEMENTED — Flag 13

**Concept**: An encoded string is found in a file (ROT13, base64, reversed text, XOR, etc.). No built-in command can decode it. The player must write a decoder script with `nano` and run it with `node`.

**Example setup**:

- A file contains something like: `ENCODED: 53 4C 41 47 7B ...` (hex-encoded flag)
- Or a ROT13-encoded string, or a reversed + shifted cipher
- Player creates `decode.js`, writes the decoding logic, runs `node("decode.js")`
- The script uses `cat()` to read the encoded file, processes it, and `echo()`s the flag

**Why it's great**:

- Tests actual JavaScript knowledge — the core identity of this CTF
- Multiple valid solutions (the player's creativity matters)
- Difficulty scales with the encoding complexity

**Possible encodings** (from easy to hard):

- Reversed string: `}rekc4h_3ht_3d0c{ GALF` → just `.split('').reverse().join('')`
- ROT13: standard letter rotation
- Hex encoding: `46 4C 41 47 7B ...` → `String.fromCharCode(0x46, ...)`
- XOR with a known key
- Multi-step: base64 then reversed, or XOR then hex

---

## Idea 3: Script-Based Privilege Discovery ✅ PLANNED — Flag 15 (void)

**Concept**: Scattered clues across multiple files on a machine. Player writes a `node` script that reads several files with `cat()` and combines/filters the results to extract a password or key.

**Example setup**:

- 5 log files each contain one character of a password at a specific line
- A hint says "the password is at line 42 of each log"
- Player writes a script that reads all logs and extracts the characters

**Skills**: nano, node, cat (programmatic), string manipulation

---

## Idea 4: Exploit Script (Favorite) ✅ PLANNED — Flag 16 (abyss)

**Concept**: A service or challenge file requires a computed input — a hash, a math result, a token. The player must write and run a script that computes the answer. Since `node` has access to all terminal commands, the script can read challenge data, compute the solution, and output the flag.

**Example setups**:

### Variant A: Hash Challenge

- A file says: "Provide the MD5 hash of your username concatenated with this nonce: `a8f3e2`"
- Player writes a script that computes the hash and compares/submits it
- Since the terminal doesn't have a hash command, they must implement or use the available tools

### Variant B: Math/Logic Challenge

- A file contains a series of numbers or a mathematical puzzle
- The answer is too complex to compute manually
- Player writes a script to solve it, output is the flag

### Variant C: Brute Force

- A locked file or service requires a 4-digit PIN
- Player writes a script that tries combinations using available commands
- Finding the right PIN reveals the flag

**Why it's great**:

- Feels like real hacking — writing an exploit
- Combines multiple skills (reading files, writing code, executing)
- The "aha moment" when the script works is very satisfying

---

## Idea 5: Config File Injection

**Concept**: A machine has a service that reads a config or script file. Player `nano`s the file to inject code, then triggers execution via `node`, revealing a hidden flag.

**Example setup**:

- `/etc/cron.d/backup.js` is writable and gets executed by a simulated service
- Player adds code to read a protected file and output its contents
- Running `node("/etc/cron.d/backup.js")` executes their injected code

**Skills**: nano, node, understanding of code injection

---

## Idea 6: Cron Job / Automation Puzzle

**Concept**: A hint says "the system runs `/home/user/job.js` periodically." The file doesn't exist yet. Player creates it with `nano`, writes code that reads a secret location and outputs the flag, then runs it with `node`.

**Example setup**:

- Hint in a log: "cron: /home/ghost/job.js not found, skipping"
- Player creates the file, writes code to explore and find a hidden flag
- The flag is in a location only discoverable by programmatic exploration

**Skills**: nano (create new file), node, creative exploration

---

## Idea 7: Multi-File Assembly

**Concept**: Flag fragments are spread across multiple machines/files. Player writes a script that reads all fragments and assembles them. Extends the existing split-key mechanic but requires code to solve.

**Example setup**:

- 4 files each contain a piece: `RkxBR3t`, `waW5h`, `bF9m`, `bGFnfQ==`
- Individually meaningless, but concatenated and base64-decoded: `FLAG{final_flag}`
- Player writes a script to cat all files, concatenate, and decode

**Skills**: nano, node, cat (programmatic), base64 decoding

---

## Progression Placement

| Idea                    | Difficulty   | Best placement   | Notes                       |
| ----------------------- | ------------ | ---------------- | --------------------------- |
| 1 (Fix the Script)      | Intermediate | After flag 7     | Gentle intro to nano + node |
| 2 (Code the Decoder)    | Advanced     | Flag 8-10 range  | Core JS skill test          |
| 3 (Script Discovery)    | Advanced     | Flag 8-10 range  | Programmatic file reading   |
| 4 (Exploit Script)      | Expert       | Flag 11-12 range | Peak challenge              |
| 5 (Config Injection)    | Advanced     | Flag 10 range    | Creative thinking           |
| 6 (Cron Job)            | Intermediate | After flag 7     | Create-from-scratch intro   |
| 7 (Multi-File Assembly) | Expert       | Bonus/post-game  | Capstone challenge          |

---

## Implementation Considerations

- `node` already has access to all terminal commands (echo, cat, etc.) via the execution context
- Scripts can be async — `node` handles both expression and statement modes
- File persistence via patches means player-created scripts survive page reloads
- nano + node are user-tier commands (not available to guests)
- Could add new machines or extend existing ones for these flags
- Encoding difficulty should match the target audience — not too cryptographic
