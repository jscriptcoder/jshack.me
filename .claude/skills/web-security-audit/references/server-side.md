# Server-Side Vulnerability Audit Reference

This reference covers 14 server-side vulnerability categories. For each category, it describes what to look for in source code, common developer mistakes, and how to remediate.

## Table of Contents

1. [SQL Injection](#sql-injection)
2. [Authentication](#authentication)
3. [Path Traversal](#path-traversal)
4. [Command Injection](#command-injection)
5. [Business Logic](#business-logic)
6. [Information Disclosure](#information-disclosure)
7. [Access Control](#access-control)
8. [File Upload](#file-upload)
9. [Race Conditions](#race-conditions)
10. [SSRF](#ssrf)
11. [XXE](#xxe)
12. [NoSQL Injection](#nosql-injection)
13. [API Security](#api-security)
14. [Web Cache Deception](#web-cache-deception)

---

## SQL Injection

SQL injection (SQLi) occurs when user-controlled input is incorporated into database queries without proper sanitization, allowing attackers to manipulate query logic, extract data, modify records, or even execute system commands.

### What to Look For in Code

**String concatenation or interpolation in queries:**

```python
# VULNERABLE — Python
query = f"SELECT * FROM users WHERE username = '{username}'"
cursor.execute(query)

# VULNERABLE — Node.js
db.query("SELECT * FROM products WHERE id = " + req.params.id)

# VULNERABLE — Java
String query = "SELECT * FROM users WHERE email = '" + email + "'";
stmt.executeQuery(query);
```

**ORM raw query methods:**
Even with an ORM, raw/literal SQL bypasses protections:

```python
# VULNERABLE — Django
User.objects.raw(f"SELECT * FROM auth_user WHERE username = '{name}'")
User.objects.extra(where=[f"username = '{name}'"])

# VULNERABLE — SQLAlchemy
db.session.execute(text(f"SELECT * FROM users WHERE id = {uid}"))
```

```typescript
// VULNERABLE — TypeORM
repository.query(`SELECT * FROM user WHERE name = '${name}'`);

// VULNERABLE — Sequelize
sequelize.query(`SELECT * FROM users WHERE id = ${id}`);

// VULNERABLE — Prisma raw
prisma.$queryRawUnsafe(`SELECT * FROM users WHERE email = '${email}'`);
```

**Stored procedures with dynamic SQL:**
Even prepared statements inside stored procedures can be vulnerable if they internally build dynamic SQL.

**Second-order SQLi:**
User input is stored safely but later retrieved and used in a query without parameterization. Look for data flows where stored values (usernames, profile fields) are later used in queries.

**Locations beyond WHERE clauses:**
SQLi can occur in ORDER BY, GROUP BY, LIMIT, table names, column names, INSERT VALUES, and UPDATE SET clauses. These are often overlooked because parameterized queries may not support dynamic identifiers.

### Remediation

- Always use parameterized queries / prepared statements
- For dynamic identifiers (table/column names, ORDER BY), use allowlists
- Use ORM methods properly — avoid `.raw()`, `.extra()`, `$queryRawUnsafe()`
- Apply least-privilege database permissions
- Validate and cast input types (e.g., numeric IDs should be parsed as integers)

```python
# SAFE — parameterized
cursor.execute("SELECT * FROM users WHERE username = %s", (username,))

# SAFE — Django ORM
User.objects.filter(username=name)
```

```typescript
// SAFE — parameterized in Node.js
db.query('SELECT * FROM products WHERE id = $1', [req.params.id]);

// SAFE — Prisma
prisma.user.findUnique({ where: { email } });
```

---

## Authentication

Authentication vulnerabilities allow attackers to compromise login mechanisms, brute-force credentials, hijack sessions, or bypass multi-factor authentication.

### What to Look For in Code

**Weak password policies:**

- No minimum length or complexity requirements
- No check against breached password lists
- Allowing trivially guessable passwords

**Brute-force unprotected login:**

- No rate limiting on login endpoints
- No account lockout after failed attempts
- No CAPTCHA or progressive delays
- Login responses that reveal whether the username or password was incorrect (username enumeration)

**Session management flaws:**

- Session tokens with insufficient entropy or predictable patterns
- Sessions not invalidated on logout or password change
- Session fixation — accepting session IDs from URL parameters or pre-authentication tokens
- Missing `HttpOnly`, `Secure`, `SameSite` flags on session cookies

**Remember-me / persistent login tokens:**

- Tokens that encode predictable values (username, timestamp)
- Tokens stored in plain text in the database
- No expiration or rotation of persistent tokens

**Password reset flaws:**

- Reset tokens sent in URL query parameters (logged in referrer headers, browser history)
- Tokens that don't expire or are reusable
- Host header injection in password reset emails (attacker controls the reset link domain)
- Lack of rate limiting on reset requests

**MFA bypass patterns:**

- MFA check happens on a separate page and can be skipped by navigating directly to the authenticated area
- MFA status tracked client-side (cookies, hidden fields)
- Brute-forceable TOTP codes without rate limiting
- MFA not required for password reset flow

### Remediation

- Enforce strong passwords, check against known breached lists (e.g., HaveIBeenPwned API)
- Implement rate limiting and account lockout with exponential backoff
- Use generic error messages: "Invalid username or password"
- Generate session tokens with a cryptographically secure random generator (minimum 128 bits of entropy)
- Set cookie attributes: `HttpOnly`, `Secure`, `SameSite=Lax` (or `Strict`)
- Invalidate all sessions on password change
- Use signed, time-limited, single-use password reset tokens
- Enforce MFA server-side in a non-skippable step

---

## Path Traversal

Path traversal (directory traversal) allows attackers to read or write arbitrary files on the server by manipulating file path parameters.

### What to Look For in Code

**User input in file operations:**

```python
# VULNERABLE
filename = request.args.get('file')
return send_file(f'/var/www/uploads/{filename}')

# Attack: ?file=../../../etc/passwd
```

```typescript
// VULNERABLE
const filePath = path.join('/uploads', req.query.filename);
res.sendFile(filePath);

// Attack: ?filename=../../../etc/passwd
```

**Bypass patterns to watch for:**

- `../` and `..\\` sequences
- URL-encoded variants: `%2e%2e%2f`, `%252e%252e%252f` (double encoding)
- Null byte injection: `file.txt%00.png` (in older runtimes, truncates at null byte)
- Absolute path injection: `/etc/passwd` instead of relative traversal
- Nested sequences: `....//` which after stripping `../` still yields `../`

**Common flawed defenses:**

- Stripping `../` once (bypassed with `....//`)
- Checking that the path starts with expected directory but not resolving symlinks
- Extension validation without canonicalization

### Remediation

- Canonicalize the path (resolve `.`, `..`, symlinks) then verify it starts with the intended base directory
- Use an allowlist of permitted filenames or a mapping (ID → filename) instead of accepting filenames directly
- Run the application with minimal filesystem permissions

```python
# SAFE — Python
import os
base = '/var/www/uploads'
requested = os.path.realpath(os.path.join(base, filename))
if not requested.startswith(base + os.sep):
    abort(403)
```

```typescript
// SAFE — Node.js
const base = path.resolve('/uploads');
const requested = path.resolve(path.join('/uploads', filename));
if (!requested.startsWith(base + path.sep)) {
  return res.status(403).send('Forbidden');
}
```

---

## Command Injection

OS command injection occurs when user input is passed to system shell commands, allowing attackers to execute arbitrary commands on the host.

### What to Look For in Code

**Shell execution with user input:**

```python
# VULNERABLE
os.system(f"ping -c 1 {ip_address}")
subprocess.call(f"nslookup {domain}", shell=True)

# Attack: ; rm -rf / or | cat /etc/passwd
```

```typescript
// VULNERABLE
exec(`convert ${inputFile} ${outputFile}`);
execSync(`whois ${domain}`);
```

**Dangerous functions by language:**

- Python: `os.system()`, `os.popen()`, `subprocess.*` with `shell=True`, `eval()`, `exec()`
- Node.js: `child_process.exec()`, `child_process.execSync()`, `eval()`
- Java: `Runtime.exec()`, `ProcessBuilder` with shell interpretation
- PHP: `system()`, `exec()`, `passthru()`, `shell_exec()`, backtick operator

**Injection operators:**
`;`, `&&`, `||`, `|`, `` ` `` (backtick substitution), `$(command)`, `\n` (newline in some contexts)

### Remediation

- Avoid calling OS commands with user input entirely
- If unavoidable, use parameterized APIs that don't invoke a shell:
  ```python
  # SAFE — no shell interpretation
  subprocess.run(["ping", "-c", "1", ip_address], shell=False)
  ```
  ```typescript
  // SAFE — no shell
  execFile('ping', ['-c', '1', ipAddress]);
  ```
- Validate input against strict allowlists (e.g., IP regex for ping)
- Never use `shell=True` (Python) or `exec()` (Node.js) with user input

---

## Business Logic

Business logic vulnerabilities arise from flawed assumptions in the application's workflows. They cannot be detected by automated scanners because they require understanding the intended behavior.

### What to Look For in Code

**Price and quantity manipulation:**

- Can a user submit a negative quantity or price?
- Are calculations performed client-side and trusted by the server?
- Can discounts exceed the order total, resulting in a credit?

**Workflow bypass:**

- Can multi-step processes be completed out of order?
- Are intermediate steps validated server-side, or only by the client?
- Can users skip required steps (e.g., payment, verification, MFA)?

**Trust boundary violations:**

- Does the app trust client-side values for roles, permissions, or pricing?
- Are hidden form fields or cookies used to pass security-sensitive state?

**Inconsistent validation:**

- Are the same rules applied to all entry points for the same data?
- Can truncation of overlong inputs bypass validation (e.g., email length limits)?
- Are there integer overflow/underflow risks on quantity or amount fields?

**Coupon / discount / referral abuse:**

- Can a coupon code be reused? (See also: race conditions)
- Can referral rewards be self-triggered?
- Can free trials be extended indefinitely by re-registering?

### Remediation

- Define and document the intended state machine for every critical workflow
- Validate all state transitions server-side
- Never trust client-side calculations for pricing, quantities, or authorization
- Implement server-side checks at every step of multi-step processes
- Write tests that specifically attempt to violate business rules

---

## Information Disclosure

Information disclosure occurs when an application unintentionally reveals sensitive data to users, either through responses, error messages, metadata, or debug output.

### What to Look For in Code

**Verbose error messages:**

- Stack traces returned to the client in production
- Database error messages revealing table/column names or query structure
- Framework debug pages enabled in production (Django `DEBUG=True`, Express `app.set('env', 'development')`)

**Sensitive data in responses:**

- API responses that include fields not needed by the client (internal IDs, password hashes, tokens, other users' data)
- Comments in HTML source containing internal information
- Version numbers of frameworks, servers, libraries in headers or markup

**Configuration exposure:**

- `.env` files accessible via web
- `/debug`, `/status`, `/metrics`, `/actuator` endpoints exposed without auth
- Git directories (`.git/`) or backup files (`.bak`, `~`) accessible
- `robots.txt` or `sitemap.xml` revealing internal paths
- Source maps (`.map` files) deployed to production

**Metadata leakage:**

- EXIF data in uploaded images containing geolocation
- Timing differences revealing whether records exist (username enumeration)
- HTTP headers like `X-Powered-By`, `Server` revealing technology stack

### Remediation

- Configure separate error handling for production vs development — never expose stack traces
- Use API response serializers/schemas that explicitly define which fields are returned
- Strip unnecessary HTTP headers (`X-Powered-By`, `Server`)
- Disable debug endpoints and development tooling in production
- Audit `.gitignore` and deployment scripts to prevent sensitive files from being served
- Implement generic error responses for all unhandled exceptions

---

## Access Control

Access control vulnerabilities (also called broken authorization, IDOR, BOLA) occur when users can access resources or perform actions beyond their intended permissions.

### What to Look For in Code

**Insecure direct object references (IDOR):**

```python
# VULNERABLE — no authorization check
@app.route('/api/user/<user_id>/profile')
def get_profile(user_id):
    return User.query.get(user_id).to_dict()
    # Any authenticated user can view any other user's profile
```

**Missing authorization middleware:**

- Routes that should require specific roles but only check authentication
- Admin endpoints protected only by URL obscurity
- Authorization checked in the UI but not enforced server-side

**Horizontal privilege escalation:**

- User A can access User B's data by changing an ID parameter
- Predictable or sequential resource IDs making enumeration easy

**Vertical privilege escalation:**

- Regular users can access admin functionality by navigating to admin URLs
- Role changes possible by modifying request parameters or cookies
- API endpoints that don't enforce role-based restrictions

**Missing function-level access control:**

- Different access checks for GET vs POST/PUT/DELETE on the same resource
- Bulk/batch endpoints that bypass per-resource authorization
- Indirect references (looking up by email instead of ID) that bypass checks

**Referer-based or URL-based access control:**

- Authorization decisions based on the `Referer` header
- Access control applied only at the URL routing level, not at the data layer

### Remediation

- Implement authorization checks at the data access layer, not just routing
- Deny by default — require explicit grants for every resource and action
- Use unpredictable resource identifiers (UUIDs) to prevent enumeration (but still enforce authorization)
- Apply consistent authorization middleware to all routes
- Test authorization from the perspective of each role: can a regular user hit every admin endpoint?

---

## File Upload

File upload vulnerabilities arise when applications accept files without adequate validation, potentially allowing attackers to upload executable content, overwrite critical files, or store malicious payloads.

### What to Look For in Code

**Missing or client-side-only validation:**

- File type checked only by extension or `Content-Type` header (both attacker-controlled)
- Validation performed in JavaScript but not repeated server-side

**Dangerous patterns:**

- Uploaded files stored in a web-accessible directory and served directly
- Original filenames used without sanitization (path traversal via filenames like `../../shell.php`)
- No size limits on uploads (DoS vector)
- Execution permissions on upload directories

**Content-type confusion:**

- Polyglot files (valid image that is also valid PHP/HTML)
- SVG files containing embedded JavaScript
- MIME type sniffing by the browser executing non-HTML as HTML

**Metadata exploitation:**

- Image metadata (EXIF) containing embedded scripts or large payloads
- Archive files (ZIP) with path traversal in entry names (Zip Slip)
- Office documents with macros or external entity references

### Remediation

- Validate file type server-side by inspecting magic bytes, not just extension or Content-Type
- Generate new random filenames — never use the user-provided filename
- Store uploads outside the web root or on a separate storage service (S3, GCS)
- Serve files with `Content-Disposition: attachment` and explicit `Content-Type`
- Set `X-Content-Type-Options: nosniff` to prevent MIME sniffing
- Enforce size limits
- Strip metadata from images before storing (e.g., using an image processing library to re-encode)
- Scan uploads with antivirus where appropriate

---

## Race Conditions

Race conditions occur when an application processes concurrent requests without proper synchronization, allowing attackers to exploit time-of-check to time-of-use (TOCTOU) gaps.

### What to Look For in Code

**Limit overrun patterns (the most common type):**
Any "check then act" sequence without atomicity:

```python
# VULNERABLE — TOCTOU gap between check and update
coupon = Coupon.query.get(code)
if not coupon.used:
    apply_discount(order, coupon.value)
    coupon.used = True
    db.session.commit()
# Two simultaneous requests can both pass the `if not coupon.used` check
```

**Common limit overrun targets:**

- Coupon/promo code redemption
- Gift card / credit redemption
- Rate limiting counters
- Vote / like systems
- Account balance withdrawals
- Free trial registrations

**Hidden multi-step race conditions:**
Some operations involve sub-states that create race windows even when the overall flow appears atomic. For example, updating an email might temporarily associate the new email before confirming it, allowing another user to hijack it.

**Multi-endpoint race conditions:**
When separate endpoints (e.g., "add to cart" and "checkout") interact with shared state, sending them simultaneously can produce inconsistent results — such as completing a checkout with an item added after the price was calculated.

**Single-endpoint race conditions:**
Sending the same request twice simultaneously to an endpoint that accepts a list (e.g., updating email — send two different emails at once) can cause unexpected behavior depending on which write wins.

**Partial construction races:**
Object creation that involves multiple database writes can be exploited if the object is accessible in a partially constructed state (e.g., a user record exists but hasn't had its password set yet).

### Remediation

- Use database-level atomic operations: `UPDATE ... WHERE used = false` returning the affected row count
- Use database transactions with appropriate isolation levels (SERIALIZABLE for critical operations)
- Implement distributed locks (Redis SETNX) for operations that must be single-threaded
- Use optimistic locking with version columns
- Use `SELECT ... FOR UPDATE` to lock rows during check-then-act sequences
- Avoid relying on application-level checks for concurrency-sensitive operations

```python
# SAFE — atomic check-and-update
result = db.session.execute(
    text("UPDATE coupons SET used = true WHERE code = :code AND used = false"),
    {"code": code}
)
if result.rowcount == 1:
    apply_discount(order, coupon_value)
```

---

## SSRF

Server-side request forgery occurs when an application makes HTTP requests to a URL that is partially or fully controlled by the user, allowing attackers to access internal services, cloud metadata, or other protected resources.

### What to Look For in Code

**User-controlled URLs in server-side requests:**

```python
# VULNERABLE
url = request.args.get('url')
response = requests.get(url)
return response.text
```

```typescript
// VULNERABLE
const url = req.body.webhookUrl;
const response = await fetch(url);
```

**Common SSRF entry points:**

- Webhook URLs configured by users
- "Fetch URL" / "Import from URL" features
- PDF generation from HTML with user-controlled URLs
- Image/avatar fetching from user-provided URLs
- XML parsing with external entity resolution (XXE-to-SSRF)
- Redirect-following that resolves to internal addresses

**Bypass techniques to account for:**

- Alternative IP representations: `127.0.0.1`, `127.1`, `0`, `0x7f000001`, `2130706433`, `[::1]`
- DNS rebinding: domain resolves to public IP first, then internal IP on subsequent lookup
- Redirects: allowed domain redirects to `http://169.254.169.254/`
- URL parsing inconsistencies between validation and request libraries
- Cloud metadata endpoints: `169.254.169.254` (AWS/GCP/Azure), `fd00:ec2::254`

### Remediation

- Maintain an allowlist of permitted domains/IPs — deny by default
- Resolve the hostname and validate the IP before making the request (not just the hostname)
- Block private/reserved IP ranges: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16`, `fd00::/8`, `[::1]`
- Disable redirect-following or re-validate after redirects
- Use a dedicated egress proxy for outbound requests
- On cloud platforms, use IMDSv2 (AWS) which requires a token header, making SSRF exploitation harder

---

## XXE

XML External Entity injection occurs when an application parses XML input that contains references to external entities, allowing attackers to read files, perform SSRF, or cause denial of service.

### What to Look For in Code

**XML parsing with default settings:**
Many XML parsers allow external entities by default:

```python
# VULNERABLE — Python
from lxml import etree
tree = etree.parse(user_input)  # External entities enabled by default

# VULNERABLE — Python stdlib
from xml.etree.ElementTree import parse
```

```java
// VULNERABLE — Java
DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
// Default settings allow external entities
DocumentBuilder builder = factory.newDocumentBuilder();
Document doc = builder.parse(inputStream);
```

**Attack payloads to understand:**

- File reading: `<!ENTITY xxe SYSTEM "file:///etc/passwd">`
- SSRF: `<!ENTITY xxe SYSTEM "http://internal-server/">`
- Blind XXE via out-of-band (OOB): entity points to attacker server
- Denial of service (Billion Laughs): nested entity expansion consuming memory
- XXE via file uploads: DOCX, XLSX, SVG are all XML-based formats

**Hidden XML parsing:**

- SOAP endpoints
- SVG image processing
- Office document parsing (OOXML)
- RSS/Atom feed parsing
- SAML authentication
- XML-based configuration imports

### Remediation

- Disable external entities and DTD processing in the XML parser:

  ```python
  # SAFE — Python lxml
  parser = etree.XMLParser(resolve_entities=False, no_network=True)

  # SAFE — Python defusedxml
  import defusedxml.ElementTree as ET
  ```

  ```java
  // SAFE — Java
  factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
  factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
  factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
  ```

- Use JSON instead of XML where possible
- For file uploads in XML-based formats, use libraries that don't resolve entities

---

## NoSQL Injection

NoSQL injection occurs when user input is incorporated into NoSQL database queries (MongoDB, CouchDB, etc.) without proper sanitization, allowing attackers to manipulate query logic.

### What to Look For in Code

**Operator injection in MongoDB:**

```javascript
// VULNERABLE — if req.body.password is {"$ne": ""}
db.users.find({
  username: req.body.username,
  password: req.body.password,
});
// Matches any user where password is not empty — auth bypass
```

**JavaScript expression injection:**

```javascript
// VULNERABLE — $where with string evaluation
db.users.find({ $where: `this.username == '${username}'` });
```

**Common attack operators:**

- `$ne` — not equal (bypass auth: `{"password": {"$ne": ""}}`)
- `$gt` — greater than (match any value)
- `$regex` — extract data character by character
- `$where` — execute arbitrary JavaScript
- `$lookup` — in aggregation pipelines, can access other collections

**Entry points:**

- JSON body parameters that are passed directly to query methods
- URL query parameters parsed into objects (Express `qs` parsing can create nested objects from `user[$ne]=1`)

### Remediation

- Explicitly cast/validate input types before querying:
  ```typescript
  // SAFE — ensure values are strings, not objects
  const username = String(req.body.username);
  const password = String(req.body.password);
  ```
- Use schema validation (Mongoose schemas with strict types)
- Avoid `$where` and other JavaScript evaluation operators
- Use query builders that parameterize inputs
- Sanitize input to strip `$`-prefixed keys from user-controlled objects

---

## API Security

API security issues span multiple vulnerability classes but have specific patterns related to how APIs are designed, documented, and consumed.

### What to Look For in Code

**Broken object-level authorization (BOLA):**
The #1 API vulnerability — accessing resources by changing ID parameters without authorization checks (same as IDOR, but emphasized in API context).

**Broken function-level authorization:**
Admin API endpoints accessible to regular users. Check that middleware enforces role checks on all routes, not just the UI-facing ones.

**Mass assignment / excessive data exposure:**

```typescript
// VULNERABLE — mass assignment
const user = await User.create(req.body);
// If req.body includes { role: "admin" }, the user becomes an admin

// VULNERABLE — excessive data exposure
app.get('/api/users/:id', (req, res) => {
  const user = await User.findById(req.params.id);
  res.json(user); // Returns ALL fields including passwordHash, internalNotes, etc.
});
```

**Missing rate limiting:**

- No throttling on authentication endpoints
- No per-user or per-IP rate limits on data-access endpoints
- Pagination without limits allowing full database dumps

**Undocumented endpoints:**

- Debug or test endpoints left in production
- Endpoints discoverable via API schema files (OpenAPI/Swagger, GraphQL introspection)
- Version mismatch: `/api/v1/` has controls, `/api/v2/` doesn't

**Improper input validation:**

- No validation of request body schema
- Accepting unexpected fields
- No type checking on parameters

### Remediation

- Implement object-level authorization on every endpoint
- Use explicit allowlists for request body fields (don't pass `req.body` directly to ORM create/update)
- Define explicit response schemas that only include needed fields
- Apply rate limiting at multiple levels (per-IP, per-user, per-endpoint)
- Disable API documentation endpoints in production
- Validate all input against a schema (JSON Schema, Zod, Pydantic, etc.)

---

## Web Cache Deception

Web cache deception exploits discrepancies between how a cache server and origin server interpret ambiguous URLs, tricking the cache into storing sensitive dynamic content that an attacker can later retrieve.

### What to Look For in Code

**Path handling discrepancies:**
The vulnerability arises when:

1. The origin server serves dynamic content at a URL like `/account/settings`
2. The cache interprets a URL like `/account/settings/nonexistent.css` as a static resource and caches it
3. But the origin ignores the extra path segment and still serves the dynamic account page

**Frameworks that ignore trailing path segments:**

- REST frameworks with catch-all or prefix-based routing
- Applications using path normalization that strips unknown segments

**Cache rule misconfigurations:**

- Caching based on file extension (`.css`, `.js`, `.png`) without validating the response
- Caching based on directory prefixes (`/static/`) without verifying content type
- Not using `Cache-Control: no-store` on authenticated/dynamic responses

**Delimiter discrepancies:**
Different servers treat path delimiters differently. A URL like `/account/settings;.css` might be interpreted as `/account/settings` by the origin (treating `;` as a parameter delimiter) but as a `.css` file by the cache.

### Remediation

- Set `Cache-Control: no-store` on all authenticated/dynamic responses
- Configure cache rules based on response headers (Content-Type, Cache-Control), not URL patterns
- Ensure the origin returns 404 for paths it doesn't explicitly serve
- Normalize URL interpretation between the cache and origin server
- Use the `Vary` header appropriately for responses that differ by user
