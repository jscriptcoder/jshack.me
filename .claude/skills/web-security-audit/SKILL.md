---
name: web-security-audit
description: >
  Comprehensive web application security auditing skill based on industry-standard vulnerability taxonomies.
  Use this skill whenever the user asks to audit, review, or analyze web application code for security
  vulnerabilities. Also trigger when the user mentions: security review, penetration testing, vulnerability
  assessment, secure code review, threat modeling, OWASP, security audit, hardening, attack surface analysis,
  or any specific vulnerability class like XSS, SQLi, CSRF, SSRF, IDOR, prototype pollution, request smuggling,
  race conditions, JWT attacks, OAuth flaws, deserialization, template injection, or cache poisoning.
  This skill covers 31 vulnerability categories across server-side, client-side, and advanced attack classes.
  If the user pastes code and asks "is this secure?" or "find vulnerabilities", use this skill.
  Even if the user just mentions a single vulnerability type, use this skill to provide thorough, structured guidance.
---

# Web Application Security Audit Skill

This skill enables systematic, thorough security auditing of web application source code. It covers 31 vulnerability categories organized into three tiers: server-side, client-side, and advanced.

## How to Use This Skill

When the user provides code or asks for a security audit:

1. **Read the appropriate reference file(s)** based on what you're auditing:
   - `references/server-side.md` — Injection flaws, auth issues, access control, file handling, SSRF, race conditions, business logic, API testing, caching
   - `references/client-side.md` — XSS, CSRF, CORS, clickjacking, DOM-based vulns, WebSockets
   - `references/advanced.md` — Deserialization, LLM attacks, GraphQL, SSTI, cache poisoning, Host header attacks, request smuggling, OAuth, JWT, prototype pollution

2. **For a full audit**, read all three reference files and systematically check each category against the codebase.

3. **For targeted reviews**, read only the relevant reference file(s) based on the technology stack or specific concern.

## Audit Workflow

### Step 1: Reconnaissance — Understand the Stack

Before diving into vulnerabilities, understand what you're looking at:

- Language and framework (Express/Fastify, Django/Flask, Spring, Rails, etc.)
- Database layer (SQL, NoSQL, ORM usage)
- Authentication mechanism (sessions, JWT, OAuth)
- Frontend framework (React, Vue, Angular, server-rendered templates)
- Caching infrastructure (CDN, reverse proxy, application cache)
- API style (REST, GraphQL, gRPC)
- Deployment context (reverse proxy, load balancer, containerized)

This determines which vulnerability categories are most relevant.

### Step 2: Triage — Prioritize by Risk

Not all vulnerability classes apply equally to every app. Prioritize based on:

**Critical (check first):**

- Injection (SQL, NoSQL, command, template) — any app with user input + database/system interaction
- Authentication and session management — any app with login
- Access control / authorization — any app with roles or multi-tenancy
- File uploads — if the app accepts files
- SSRF — if the app makes outbound requests based on user input

**High (check second):**

- XSS — any app rendering user-controlled content
- CSRF — any app with state-changing operations via cookies
- Insecure deserialization — if the app deserializes user-controlled data
- Race conditions — any app with limit-based logic (credits, coupons, votes)
- JWT/OAuth flaws — if using these for auth

**Medium (check based on stack):**

- Prototype pollution — JavaScript/Node.js apps
- Request smuggling — apps behind reverse proxies
- Cache poisoning/deception — apps with caching layers
- GraphQL-specific issues — GraphQL APIs
- CORS misconfigurations — apps with cross-origin API calls
- Host header attacks — apps that use the Host header for routing or URL generation

**Context-dependent:**

- LLM attacks — apps integrating AI/LLM features
- WebSocket vulnerabilities — apps using WebSockets
- DOM-based vulnerabilities — SPAs with complex client-side routing

### Step 3: Systematic Review

For each applicable vulnerability category, follow the detection patterns and code-level indicators described in the reference files. The references provide:

- What to look for in code (patterns, anti-patterns, danger signals)
- Common mistakes developers make
- Specific remediation guidance with code examples
- Edge cases and bypass techniques to be aware of

### Step 4: Report Findings

Structure findings with:

- **Severity**: Critical / High / Medium / Low / Informational
- **Vulnerability class**: The specific category from this skill
- **Location**: File, line, function where the issue exists
- **Description**: What the vulnerability is and why it's dangerous
- **Proof of concept**: How an attacker could exploit it (conceptual)
- **Remediation**: Specific code changes to fix the issue
- **References**: Link to relevant CWE, OWASP, or documentation

## Quick Reference — All 31 Vulnerability Categories

### Server-Side (14 categories)

1. SQL Injection — `references/server-side.md#sql-injection`
2. Authentication flaws — `references/server-side.md#authentication`
3. Path traversal — `references/server-side.md#path-traversal`
4. OS command injection — `references/server-side.md#command-injection`
5. Business logic vulnerabilities — `references/server-side.md#business-logic`
6. Information disclosure — `references/server-side.md#information-disclosure`
7. Access control — `references/server-side.md#access-control`
8. File upload vulnerabilities — `references/server-side.md#file-upload`
9. Race conditions — `references/server-side.md#race-conditions`
10. Server-side request forgery (SSRF) — `references/server-side.md#ssrf`
11. XXE injection — `references/server-side.md#xxe`
12. NoSQL injection — `references/server-side.md#nosql-injection`
13. API testing — `references/server-side.md#api-security`
14. Web cache deception — `references/server-side.md#web-cache-deception`

### Client-Side (6 categories)

15. Cross-site scripting (XSS) — `references/client-side.md#xss`
16. Cross-site request forgery (CSRF) — `references/client-side.md#csrf`
17. Cross-origin resource sharing (CORS) — `references/client-side.md#cors`
18. Clickjacking — `references/client-side.md#clickjacking`
19. DOM-based vulnerabilities — `references/client-side.md#dom-based`
20. WebSockets — `references/client-side.md#websockets`

### Advanced (11 categories)

21. Insecure deserialization — `references/advanced.md#deserialization`
22. Web LLM attacks — `references/advanced.md#llm-attacks`
23. GraphQL API vulnerabilities — `references/advanced.md#graphql`
24. Server-side template injection (SSTI) — `references/advanced.md#ssti`
25. Web cache poisoning — `references/advanced.md#cache-poisoning`
26. HTTP Host header attacks — `references/advanced.md#host-header`
27. HTTP request smuggling — `references/advanced.md#request-smuggling`
28. OAuth authentication flaws — `references/advanced.md#oauth`
29. JWT attacks — `references/advanced.md#jwt`
30. Prototype pollution — `references/advanced.md#prototype-pollution`
31. Essential skills (encoding, obfuscation, bypasses) — `references/advanced.md#essential-skills`

## Technology-Specific Checklists

When auditing a specific stack, focus on the categories most relevant:

**Node.js / Express / TypeScript:**
Prototype pollution, NoSQL injection (if MongoDB), XSS (template engines), command injection (child_process), path traversal, SSRF, race conditions, JWT issues, deserialization

**Python / Django / Flask:**
SQL injection (raw queries), SSTI (Jinja2/Mako), SSRF, path traversal, command injection (subprocess), authentication bypasses, CSRF, deserialization (pickle), race conditions

**Java / Spring:**
SQL injection (JDBC/JPA), XXE, deserialization (Java native serialization), SSRF, SSTI (Thymeleaf/Freemarker), path traversal, access control (Spring Security misconfig)

**React / Vue / Angular (Frontend):**
DOM-based XSS (dangerouslySetInnerHTML, v-html, [innerHTML]), prototype pollution, CORS issues, open redirects, sensitive data in client-side storage, postMessage vulnerabilities

**API-focused (REST/GraphQL):**
Authentication/authorization, BOLA/IDOR, mass assignment, rate limiting, injection (SQL/NoSQL), SSRF, information disclosure, GraphQL-specific (introspection, batching, depth)
