# CSRF: Vulnerable vs Protected

A tiny, runnable demo of a Cross-Site Request Forgery (CSRF) vulnerability
and how to fix it. No frameworks beyond Express, no build step — clone it,
run two commands, and watch a real attack succeed, then fail.

> **What this project proves, hands-on:** a logged-in user visits an
> unrelated page, and — without clicking anything, without re-entering a
> password — their account email on a *completely different site* gets
> changed. Then we fix it and prove the same attack no longer works.

---

## What is CSRF, in one paragraph

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

### 1. Start the demo app

```bash
cd server
npm install
MODE=vulnerable PORT=3000 node server.js
```

Open **http://localhost:3000/login**, click "Log in as demo user," and
you'll land on a dashboard showing an account email and a form to change
it. This is the app we're attacking.

### 2. Start the attacker site (in a second terminal)

```bash
cd attacker-site
node serve.js
```

This serves `attack.html` at **http://127.0.0.1:8080/attack.html**.

> **Why `127.0.0.1` and not another `localhost` port?** Browsers define
> "same site" by scheme + registrable domain — port numbers don't count.
> Two `localhost` ports would still be treated as the *same* site, which
> would make this demo meaningless. `localhost` and `127.0.0.1`, however,
> are treated as different sites, which is exactly the cross-site
> condition CSRF protections are designed to catch.

### 3. Run the attack

With the app still logged in (in the same browser), open
**http://127.0.0.1:8080/attack.html**. Then go back to
**http://localhost:3000/dashboard** and refresh.

**In vulnerable mode, the email will have changed** — to
`hacked-via-get@evil.com` — even though you never touched the real form.

### 4. Now run the protected version and repeat

Stop the server (`Ctrl+C`) and restart it in protected mode:

```bash
cd server
MODE=protected PORT=3000 node server.js
```

Repeat steps 2–3. This time the dashboard email is unchanged, and if you
open the browser dev tools → Network tab during the attack, you'll see
the malicious requests come back as `404` and `403`.

---

## What actually changed between the two modes

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

## What a real production app would add on top of this

This demo isolates CSRF specifically. A real account-email-change
endpoint should also have, independent of CSRF protection:

- Re-authentication or a confirmation email before the change takes effect
- Rate limiting (see the rate limiting mini-project in your roadmap)
- Audit logging of sensitive account changes
- Input validation on the email format server-side, not just client-side
