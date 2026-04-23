# Client-Side Vulnerability Audit Reference

This reference covers 6 client-side vulnerability categories. These vulnerabilities involve the browser and client-side code, adding an additional layer of complexity over server-side issues.

## Table of Contents
1. [XSS (Cross-Site Scripting)](#xss)
2. [CSRF (Cross-Site Request Forgery)](#csrf)
3. [CORS (Cross-Origin Resource Sharing)](#cors)
4. [Clickjacking](#clickjacking)
5. [DOM-Based Vulnerabilities](#dom-based)
6. [WebSockets](#websockets)

---

## XSS

Cross-site scripting (XSS) occurs when an application includes untrusted data in its output without proper encoding, allowing attackers to execute arbitrary JavaScript in other users' browsers. XSS can lead to session hijacking, credential theft, defacement, and malware distribution.

### Three Types of XSS

**Reflected XSS:**
User input from the request is immediately echoed in the response without encoding. The attack payload is delivered via a crafted URL.

**Stored XSS:**
User input is persisted (database, file, etc.) and later rendered to other users without encoding. Higher impact because it doesn't require victim interaction with a malicious link.

**DOM-based XSS:**
The vulnerability exists entirely in client-side JavaScript. User-controlled input (URL fragment, `document.referrer`, `postMessage` data) flows into a dangerous sink (`innerHTML`, `eval`, `document.write`) without sanitization.

### What to Look For in Code

**Server-side template injection of user data without encoding:**
```python
# VULNERABLE — Jinja2 with |safe filter
return render_template('page.html', name=user_input)
# In template: {{ name|safe }}  ← disables auto-escaping

# VULNERABLE — Flask Markup
from markupsafe import Markup
return Markup(f"<p>{user_input}</p>")
```

```javascript
// VULNERABLE — EJS
<%= userInput %>   // EJS auto-escapes, but:
<%- userInput %>   // This does NOT escape — raw output
```

**React/Vue/Angular dangerous patterns:**
```tsx
// VULNERABLE — React
<div dangerouslySetInnerHTML={{ __html: userContent }} />

// VULNERABLE — React href
<a href={userProvidedUrl}>Click</a>
// Attack: href="javascript:alert(1)"
```

```vue
<!-- VULNERABLE — Vue -->
<div v-html="userContent"></div>
```

```typescript
// VULNERABLE — Angular
// bypassSecurityTrustHtml(), bypassSecurityTrustScript(), etc.
this.sanitizer.bypassSecurityTrustHtml(userContent)

// VULNERABLE — Angular template
<div [innerHTML]="userContent"></div>
// Angular sanitizes innerHTML by default, but combined with bypassSecurityTrust* it's dangerous
```

**DOM sinks (client-side JS):**
```javascript
// VULNERABLE — DOM XSS sinks
document.getElementById('output').innerHTML = userInput
document.write(userInput)
element.outerHTML = userInput
eval(userInput)
setTimeout(userInput, 0)
setInterval(userInput, 1000)
new Function(userInput)
element.setAttribute('onclick', userInput)
element.style.cssText = userInput
location = userInput  // open redirect, but can be javascript: URL
```

**DOM sources (where attacker-controlled data enters):**
`location.hash`, `location.search`, `location.href`, `document.referrer`, `document.cookie`, `window.name`, `postMessage` data, `localStorage`/`sessionStorage` values

**Contexts where encoding requirements differ:**
- HTML body: HTML entity encoding (`<` → `&lt;`)
- HTML attributes: attribute encoding, plus ensure values are quoted
- JavaScript strings: JavaScript escaping (`'` → `\'`, and beware of `</script>` injection)
- URLs: URL encoding, plus validate scheme is `http:` or `https:` (block `javascript:`)
- CSS: CSS escaping (rare but possible via `style` attributes or `expression()`)

**CSP bypass patterns to be aware of:**
- `unsafe-inline` in CSP negates most XSS protection
- `unsafe-eval` allows `eval()` -based attacks
- Overly broad allowlists (e.g., allowing all of `*.googleapis.com` which hosts JSONP endpoints)
- `base-uri` not restricted — attacker can change the base URL to hijack relative script loads
- Missing `object-src` — allows Flash/Java plugin-based execution
- Script gadgets in allowed libraries (e.g., AngularJS `ng-app` + template injection on pages that allow `*.googleapis.com` for CDN)

### Remediation
- Use auto-escaping template engines and never disable auto-escaping unless absolutely necessary
- In React, avoid `dangerouslySetInnerHTML` — if you must use it, sanitize with DOMPurify first
- In Vue, avoid `v-html` with user content — use text interpolation `{{ }}` instead
- For DOM manipulation, use `textContent` instead of `innerHTML`
- Validate URL schemes: only allow `http:` and `https:` for user-provided URLs
- Implement a strong Content Security Policy (CSP):
  - Remove `unsafe-inline` and `unsafe-eval`
  - Use nonce-based or hash-based script allowlisting
  - Set `base-uri 'self'`
  - Set `object-src 'none'`
- Use the `HttpOnly` flag on session cookies to limit impact of XSS
- Apply context-appropriate encoding at output time, not input time

---

## CSRF

Cross-site request forgery forces an authenticated user's browser to send a forged request to a vulnerable application, performing an unwanted action using the victim's session.

### What to Look For in Code

**Missing CSRF tokens:**
```python
# VULNERABLE — state-changing POST with no CSRF token
@app.route('/transfer', methods=['POST'])
@login_required
def transfer():
    amount = request.form['amount']
    to_account = request.form['to']
    execute_transfer(current_user, to_account, amount)
```

**Flawed CSRF token validation:**
- Token present but not validated server-side
- Token validated only if present — omitting the token bypasses the check
- Token not tied to the user's session (attacker can use their own valid token)
- Token shared across the entire application rather than per-form/per-action
- Token transmitted in a cookie (which is sent automatically) instead of in a request body/header

**SameSite cookie misconfigurations:**
- `SameSite=None` explicitly set (needed for legitimate cross-site use, but removes CSRF protection)
- `SameSite` not set on older browsers that don't default to `Lax`
- `SameSite=Lax` still allows GET-based CSRF — check if any state-changing actions use GET

**Referer-based validation flaws:**
- Checking only that `Referer` contains the expected domain (attacker creates `attacker.com/target.com`)
- Not validating when `Referer` is absent (can be suppressed with `<meta name="referrer" content="no-referrer">`)

**Method override bypass:**
Some frameworks allow overriding the HTTP method via `_method` parameter or `X-HTTP-Method-Override` header. A GET request (which bypasses CSRF for `SameSite=Lax`) can become a POST.

### Remediation
- Use framework-provided CSRF protection (Django `{% csrf_token %}`, Express `csurf`, Spring CSRF)
- Ensure CSRF tokens are:
  - Unique per session (or per request for sensitive operations)
  - Validated server-side on every state-changing request
  - Tied to the user's session
  - Not predictable
- Set `SameSite=Lax` (or `Strict`) on session cookies
- Don't perform state-changing operations via GET requests
- For AJAX-heavy apps, use the double-submit cookie pattern or custom header pattern (custom headers cannot be sent cross-origin without CORS preflight)

---

## CORS

Cross-Origin Resource Sharing misconfigurations can allow malicious websites to read sensitive data from your API by sending cross-origin requests with the victim's credentials.

### What to Look For in Code

**Reflecting the Origin header without validation:**
```javascript
// VULNERABLE — reflects any origin
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    next()
})
```
This is equivalent to allowing any website to make authenticated requests to your API.

**Overly permissive origin allowlists:**
```javascript
// VULNERABLE — regex that matches too broadly
const allowedOrigin = /example\.com/  // Matches "evil-example.com" too
const allowedOrigin = /^https?:\/\/.*\.example\.com/  // Matches "https://evil.example.com.attacker.com"
```

**`null` origin allowed:**
```javascript
// VULNERABLE — allows null origin
if (origin === 'null' || allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
}
// Sandboxed iframes and data: URLs send Origin: null
```

**Wildcard with credentials:**
`Access-Control-Allow-Origin: *` with `Access-Control-Allow-Credentials: true` is blocked by browsers, but some developers work around this by dynamically reflecting the origin (which creates the same vulnerability).

**Internal network CORS:**
APIs intended for internal use that have permissive CORS, accessible from a compromised browser on the internal network.

### Remediation
- Maintain a strict allowlist of permitted origins — validate the full origin string exactly
- Never reflect the `Origin` header without validation when `Access-Control-Allow-Credentials` is `true`
- Don't allow the `null` origin
- Use a proper origin comparison (exact string match against a set, not regex unless very carefully crafted)
- For public APIs that don't need credentials, `Access-Control-Allow-Origin: *` without `Allow-Credentials` is fine
- Apply CORS configuration consistently across all endpoints

```typescript
// SAFE — strict origin allowlist
const ALLOWED_ORIGINS = new Set([
    'https://app.example.com',
    'https://admin.example.com'
])

app.use((req, res, next) => {
    const origin = req.headers.origin
    if (origin && ALLOWED_ORIGINS.has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Access-Control-Allow-Credentials', 'true')
    }
    next()
})
```

---

## Clickjacking

Clickjacking (UI redressing) tricks a user into clicking on an invisible or disguised element on a malicious page, by overlaying the target application in a transparent iframe.

### What to Look For in Code

**Missing frame protection headers:**
- No `X-Frame-Options` header
- No `Content-Security-Policy: frame-ancestors` directive
- `X-Frame-Options: ALLOW-FROM` used (not supported by modern browsers)

**Framing-sensitive pages:**
Any page where a single click performs a significant action is a clickjacking target:
- Delete account, change email, change password
- Transfer funds, authorize payments
- Grant permissions, accept terms
- Toggle settings (enable/disable security features)

**Multi-step clickjacking:**
Attackers can guide users through multiple framed clicks by repositioning the iframe or using multiple overlays, effectively walking the user through a multi-step workflow.

**DOM-based frame-busting bypasses:**
JavaScript frame-busters like `if (top !== self) top.location = self.location` can be bypassed:
- Attacker sets `sandbox` attribute on iframe (prevents scripts in framed page from running)
- `onbeforeunload` handlers can block navigation
- Double framing can confuse `top` vs `parent` checks

### Remediation
- Set `Content-Security-Policy: frame-ancestors 'self'` (or `'none'` if the page should never be framed)
- Set `X-Frame-Options: DENY` or `SAMEORIGIN` as a fallback for older browsers
- Don't rely on JavaScript frame-busting alone
- For highly sensitive actions, require re-authentication or CSRF tokens (which also protect against clickjacking)

---

## DOM-Based

DOM-based vulnerabilities occur entirely in client-side JavaScript, where user-controlled data flows from a source to a dangerous sink without proper sanitization. Unlike reflected/stored vulnerabilities, the server may never see the malicious payload.

### What to Look For in Code

**Dangerous source → sink flows:**

Sources (attacker-controlled input):
`location.hash`, `location.search`, `location.href`, `location.pathname`, `document.referrer`, `document.cookie`, `window.name`, `postMessage` event data, `localStorage`, `sessionStorage`, URL fragment identifiers, web storage values set by other pages

Sinks (where data causes harm):

| Sink | Impact |
|------|--------|
| `innerHTML`, `outerHTML` | XSS |
| `document.write()`, `document.writeln()` | XSS |
| `eval()`, `Function()`, `setTimeout(string)`, `setInterval(string)` | XSS |
| `element.setAttribute('on*', ...)` | XSS |
| `location`, `location.href`, `location.assign()`, `location.replace()` | Open redirect |
| `element.src` (script, iframe) | Script injection |
| `$.html()`, `$(userInput)` (jQuery) | XSS |
| `postMessage` (sending sensitive data to `*`) | Data leakage |
| `document.domain` | Origin relaxation |
| `WebSocket(userInput)` | Connection hijack |
| `fetch(userInput)`, `XMLHttpRequest.open(userInput)` | SSRF-like |
| `crypto.subtle` (with user-controlled parameters) | Crypto weakness |

**jQuery-specific patterns:**
```javascript
// VULNERABLE — jQuery selector with user input
$(location.hash)           // If hash is #<img/src=x onerror=alert(1)>
$('#' + userInput)         // If userInput contains HTML

// VULNERABLE — jQuery html sink
$('#output').html(userInput)

// VULNERABLE — jQuery attr with event handlers
$('#el').attr('onclick', userInput)
```

**postMessage vulnerabilities:**
```javascript
// VULNERABLE — no origin check
window.addEventListener('message', (event) => {
    // Missing: if (event.origin !== 'https://trusted.com') return
    document.getElementById('output').innerHTML = event.data
})

// VULNERABLE — sending to any origin
parent.postMessage(sensitiveData, '*')  // Should be specific origin
```

**Open redirect via DOM:**
```javascript
// VULNERABLE
const returnUrl = new URLSearchParams(location.search).get('next')
location.href = returnUrl  // Can redirect to attacker site or javascript: URL
```

### Remediation
- Use `textContent` instead of `innerHTML` for displaying text
- Sanitize HTML content with DOMPurify before inserting into the DOM
- Always validate `event.origin` in `postMessage` handlers
- Never use `eval()` or `Function()` with user-controlled data
- For redirects, validate URLs against an allowlist of paths or domains, and block `javascript:` scheme
- Use jQuery `.text()` instead of `.html()` for user content
- In postMessage sends, always specify the target origin (never `'*'`)
- Audit all data flows from DOM sources to sinks — this is the core of DOM-based security

---

## WebSockets

WebSocket vulnerabilities arise from the persistent, bidirectional nature of WebSocket connections, which can lack the same-origin protections that apply to regular HTTP requests.

### What to Look For in Code

**Missing origin validation on handshake:**
```javascript
// VULNERABLE — accepts WebSocket connections from any origin
const wss = new WebSocket.Server({ server })
wss.on('connection', (ws, req) => {
    // No check on req.headers.origin
})
```
This enables cross-site WebSocket hijacking — a malicious page can open a WebSocket to your server using the victim's cookies.

**No authentication on WebSocket connection:**
- WebSocket connections established without verifying the user's session
- Authentication checked only at HTTP handshake but not enforced on subsequent messages
- Session tokens passed in WebSocket URL (logged, cached, visible in referrer)

**Input handling on messages:**
- WebSocket messages parsed and used in database queries without sanitization (SQLi/NoSQLi via WebSocket)
- WebSocket messages reflected to other users without encoding (XSS via WebSocket)
- Deserialization of WebSocket message payloads without validation

**Missing rate limiting:**
- No throttling on WebSocket messages (can be used for DoS or brute-force)
- No message size limits

**Unencrypted WebSockets:**
- Using `ws://` instead of `wss://` (TLS), allowing interception of messages

### Remediation
- Validate the `Origin` header during the WebSocket handshake:
  ```javascript
  wss.on('headers', (headers, req) => {
      const origin = req.headers.origin
      if (!ALLOWED_ORIGINS.has(origin)) {
          req.destroy()
      }
  })
  ```
- Authenticate WebSocket connections using the same session mechanism as HTTP (cookies verified during handshake, or token in first message)
- Treat all WebSocket message data as untrusted — apply the same input validation as HTTP endpoints
- Use `wss://` (WebSocket Secure) exclusively
- Implement message rate limiting and size limits
- Use CSRF tokens in the WebSocket handshake for additional protection
