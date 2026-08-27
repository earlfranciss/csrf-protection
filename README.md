# CSRF Demo: Vulnerable vs Protected

A tiny, runnable demo of a Cross-Site Request Forgery (CSRF) vulnerability
and how to fix it. No frameworks beyond Express, no build step — clone it,
run two commands, and watch a real attack succeed, then fail.

> **What this project proves, hands-on:** a logged-in user visits an
> unrelated page, and — without clicking anything, without re-entering a
> password — their account email on a *completely different site* gets
> changed. Then we fix it and prove the same attack no longer works.

---

## What is CSRF?

When you log into a site, your browser holds a cookie that proves who you
are, and it attaches that cookie to *every* request to that site —
including requests triggered by a totally different, malicious page you
have open in another tab. If the target site can't tell "a request my own
form sent" apart from "a request some other page tricked my browser into
sending," an attacker can make your browser perform actions *as you*:
change your email, transfer funds, delete your account — anything a form
on the real site could do. That's CSRF.

---

## Project structure

```
csrf-demo/
├── server/                 the demo app itself (run in vulnerable OR protected mode)
│   ├── server.js
│   └── package.json
├── attacker-site/          a simulated malicious page, hosted on a different origin
│   ├── attack.html
│   └── serve.js
└── README.md                you are here
```

---

## Running it locally

Works the same on macOS, Linux, and **Windows** — the npm scripts below use
[`cross-env`](https://www.npmjs.com/package/cross-env) internally so you
never have to type shell-specific `VAR=value` syntax by hand.

### 1. Start the demo app

```bash
cd server
npm install
npm run start:vulnerable
```

Open **http://localhost:3000/login**, click "Log in as demo user," and
you'll land on a dashboard showing an account email and a form to change
it. This is the app we're attacking.

> **Windows users:** if you previously tried running `MODE=vulnerable
> PORT=3000 node server.js` directly and got `Invalid parameter`, that's
> because that syntax is Unix-shell-only (bash/zsh). `npm run
> start:vulnerable` works correctly in `cmd.exe`, PowerShell, and
> Unix shells alike — always prefer the npm script.
>
> If you want to run it manually anyway: PowerShell uses
> `$env:MODE="vulnerable"; $env:PORT="3000"; node server.js`, and `cmd.exe`
> uses `set MODE=vulnerable&&set PORT=3000&&node server.js`.

### 2. Start the attacker site (in a second terminal)

```bash
cd attacker-site
node serve.js
```

This serves `attack.html` at **http://127.0.0.1:5500/attack.html**.

> **Windows users:** if you get `EACCES: permission denied` on a port —
> this is almost always Windows' dynamic "excluded port range" (used by
> Hyper-V/WSL) grabbing that port out from under you, **not** an actual
> permissions problem. You don't need to run as Administrator — just pick
> a different port:
> ```
> PowerShell:   $env:PORT=5555; node serve.js
> cmd.exe:      set PORT=5555&&node serve.js
> ```
> You can check which ranges Windows has reserved with:
> `netsh interface ipv4 show excludedportrange protocol=tcp`

> **Why `127.0.0.1` and not another `localhost` port?** Browsers define
> "same site" by scheme + registrable domain — port numbers don't count.
> Two `localhost` ports would still be treated as the *same* site, which
> would make this demo meaningless. `localhost` and `127.0.0.1`, however,
> are treated as different sites, which is exactly the cross-site
> condition CSRF protections are designed to catch.

### 3. Run the attack

With the app still logged in (in the same browser), open
**http://127.0.0.1:5500/attack.html**. Then go back to
**http://localhost:3000/dashboard** and refresh.

**In vulnerable mode, the email will have changed** — to
`hacked-via-get@evil.com` — even though you never touched the real form.

### 4. Now run the protected version and repeat

Stop the server (`Ctrl+C`) and restart it in protected mode:

```bash
cd server
npm run start:protected
```

Repeat steps 2–3. This time the dashboard email is unchanged, and if you
open the browser dev tools → Network tab during the attack, you'll see
the malicious requests come back as `404` and `403`.

---

## Solution

This demo deliberately layers in **three separate fixes**, because real
CSRF protection is not one silver bullet — it's a combination of good
practices. Here's what each one does and why it exists on its own.

### Fix 1 — Never change state on `GET`

```js
// vulnerable mode only:
app.get("/account/email", requireLogin, (req, res) => { ... });
```

The vulnerable build exposes account changes via a `GET` request, which
means a plain `<img src="...">` tag — no JavaScript, no form, nothing
fancy — can trigger it. This is independent of cookies and CSRF tokens
entirely: browsers are *supposed* to send cookies on simple cross-site
GET requests (that's how e.g. embedded images and shared links work at
all), so a GET-based action will basically always be attackable. The fix
is simple: state-changing actions are `POST`/`PUT`/`PATCH`/`DELETE`,
never `GET`. The protected build removes this route entirely.

### Fix 2 — `SameSite` cookie attribute

```js
cookie: {
  sameSite: MODE === "protected" ? "lax" : undefined,
}
```

`SameSite=Lax` tells the browser: don't attach this cookie to
cross-site requests, *except* for top-level GET navigations (like
clicking a normal link). This blocks the classic "hidden auto-submitting
POST form" attack, because a cross-site POST no longer carries the
session cookie at all — the request arrives at the server logged out.

Two important nuances worth knowing:

- **Modern browsers already default to `Lax`** when a cookie doesn't
  specify `SameSite` at all. That's a real, relatively recent (2020+)
  browser-level improvement — it's part of *why* classic CSRF is less
  common than it used to be. But you should never rely on a browser
  default for security; always set it explicitly.
- `Lax` still allows cross-site GET navigations — which is exactly why
  Fix 1 (never change state on GET) has to hold independently. Neither
  fix alone is sufficient; that's the point of this demo.

### Fix 3 — Synchronizer CSRF token

```js
req.session.csrfToken = generateToken();      // set at login
// ...rendered into the form as a hidden input...
// ...compared on submit:
if (submittedToken !== sessionToken) return res.status(403)...
```

Even with `SameSite=Lax`, there are edge cases (older browsers, misconfigured
third-party cookie settings, subdomains) where relying on `SameSite` alone
isn't enough. The synchronizer token pattern adds a second, independent
check: a random, unguessable value is stored server-side in the session
and also embedded in the real form. An attacker's page has no way to know
this value, so any forged request is missing it or has the wrong one, and
gets rejected outright — regardless of what the browser did with cookies.

---

## Learnings

These are the questions worth being able to answer out loud, in your own
words, after building this. Written as a Q&A because that's the format
that actually surfaces gaps.

### How does the attacker even send a request without knowing my password?

```text
1. User logs into the real website
        ↓
2. Browser receives a session cookie
        ↓
3. User visits an unrelated/malicious page (same browser, different tab)
        ↓
4. That page secretly makes a request to the real website
        ↓
5. Browser automatically attaches the user's cookie (if allowed to)
        ↓
6. The real website thinks: "this is my logged-in user"
```

The attacker never sees the password or the cookie value. They don't need
to — the *browser* attaches it for them. That's the entire trick.

### Fix 1 — why does `GET` changing data matter so much?

`GET` itself doesn't do anything by definition — the **server's own code**
decides what a route does. The vulnerable demo has, conceptually:

```js
app.get("/account/email", (req, res) => {
  // changes the email
});
```

The problem is that `GET` requests are trivially easy for a browser to
trigger without any user action — a plain `<img src="...">` tag causes
one. So the fix isn't really "GET is insecure" — it's "an action that
changes data must never be reachable by a request type designed to be
triggered by accident." The rule of thumb:

```text
GET  → "Give me something"       (read-only, safe to trigger accidentally)
POST → "I want to submit/change something"   (should require intent)
```

Switching to `POST` alone blocks the `<img>` trick specifically, but it is
**not** a complete fix on its own — see Fix 2.

### Fix 2 — what does `SameSite=Lax` actually do, mechanically?

Think of the session cookie as a login pass the browser carries around.
Without `SameSite` protection, the browser hands that pass to *any* site
that asks, including a malicious one making a background request. With
`SameSite=Lax` set:

```text
Attacker's site → request to real site
        ↓
Browser: "this request is coming from a different site"
        ↓
Don't attach the login cookie
        ↓
Real site sees an anonymous, logged-out request
        ↓
Rejected (or in this demo's case, redirected to /login)
```

The one exception baked into `Lax` (not `Strict`): normal top-level GET
navigation, like clicking an ordinary link, still carries the cookie.
That's precisely the gap Fix 1 has to close on its own — `SameSite=Lax`
does not retroactively make a GET-based state change safe.

### Fix 3 — is a CSRF token the same idea as a JWT?

No, even though both get called "tokens." A JWT answers *"who is this
user?"* — it's an identity/claims credential. A CSRF token answers a
completely different question: *"did this specific request actually come
from my own form?"*

```text
At login:
  server generates a random value → stores it in the session

In the real form:
  <input type="hidden" name="csrfToken" value="...">

On submit:
  server compares the submitted token to the one in the session
  match  → allow
  no match / missing → reject (403)
```

An attacker's forged request has no way to know this value — it isn't
derivable from the cookie, the URL, or anything visible to another site —
so it arrives with a missing or wrong token and gets rejected regardless
of what happened with cookies.

### Summary of all three

```text
Fix 1 (no GET for actions)   → protects the HTTP method
Fix 2 (SameSite=Lax)         → protects the cookie
Fix 3 (CSRF token)           → verifies the request itself
```

Each one closes a gap the other two don't cover — that's why the demo
implements all three rather than picking a "best" one.

---

## Troubleshooting Log

Real issues hit while running this on Windows, kept here so the fixes
are documented instead of lost in a chat log.

### Issue: `Invalid parameter - =vulnerable` on Windows

**Command that failed:**
```
MODE=vulnerable PORT=3000 node server.js
```

**Cause:** that `VAR=value` syntax is Unix-shell-only (bash/zsh). In
`cmd.exe`, Windows tried to run a program literally named `MODE=vulnerable`
and failed.

**Fix:** added `cross-env` as a dependency and two npm scripts
(`start:vulnerable`, `start:protected`) to `server/package.json`, so the
same command works identically on Windows, macOS, and Linux:
```bash
npm run start:vulnerable
npm run start:protected
```

### Issue: `EACCES: permission denied 127.0.0.1:8080`

**Cause:** not an actual permissions problem — Windows dynamically
reserves TCP port ranges for Hyper-V/WSL, and `8080` is a common casualty.
Running as Administrator does not fix this; the port is simply
unavailable for that session.

**Fix:** changed the attacker site's default port from `8080` to `5500`,
and made it overridable via `PORT=xxxx node serve.js` (or
`$env:PORT=5555; node serve.js` in PowerShell) if `5500` is ever also
reserved. Added a clearer error message in `serve.js` pointing this out
if it happens again. Reserved ranges can be inspected with:
```
netsh interface ipv4 show excludedportrange protocol=tcp
```

### Issue: ran the "protected" attack, but saw `302 → 200`, not `404`/`403`

**Symptom:** DevTools Network tab showed the forged request to
`/account/email` return `302`, followed by `dashboard?updated=1` returning
`200` — i.e. the attack silently succeeded even though "protected mode"
was expected.

**Cause:** the server code defaults to vulnerable mode whenever `MODE`
isn't set to exactly `"protected"`:
```js
const MODE = process.env.MODE === "protected" ? "protected" : "vulnerable";
```
Running `node server.js` directly (instead of the npm script) leaves
`MODE` unset, so the server silently starts in vulnerable mode — no error,
no warning, just the wrong build running.

**How to confirm which mode is actually running, going forward:**
1. The colored badge at the top of every page: 🔴 `MODE: VULNERABLE` vs
   🟢 `MODE: PROTECTED`.
2. The startup log line printed in the terminal:
   `CSRF demo running in VULNERABLE mode` / `...PROTECTED mode`.

**Fix:** always start the server via the npm scripts
(`npm run start:vulnerable` / `npm run start:protected`), never
`node server.js` directly, unless `MODE` is being set another way you've
verified.

---

## Next Steps

This demo isolates CSRF specifically. A real account-email-change
endpoint should also have, independent of CSRF protection:

- Re-authentication or a confirmation email before the change takes effect
- Rate limiting (see the rate limiting mini-project in your roadmap)
- Audit logging of sensitive account changes
- Input validation on the email format server-side, not just client-side