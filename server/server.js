/**
 * CSRF Demo Server
 * ------------------------------------------------------------------
 * Run this in two modes:
 *   MODE=vulnerable node server.js   -> the insecure version
 *   MODE=protected  node server.js   -> the fixed version
 *
 * See README.md in the project root for the full walkthrough,
 * including WHY each protection matters and what it stops.
 * ------------------------------------------------------------------
 */

const express = require("express");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");

const MODE = process.env.MODE === "protected" ? "protected" : "vulnerable";
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// ---------------------------------------------------------------------
// Session cookie configuration
//
// VULNERABLE MODE: we don't set `sameSite` at all, so Express omits the
// attribute from the Set-Cookie header. In that case it's up to the
// browser's own default. Modern Chrome/Firefox default to "Lax" even
// when unset -- which is *why* the classic hidden-auto-submit-POST-form
// attack is harder to pull off today than it was 5-10 years ago.
//
// But "Lax" only blocks cross-site requests that aren't a top-level GET
// navigation. It does NOT stop a state-changing action that (badly)
// responds to GET requests -- which is exactly what the vulnerable
// version of this app does, on purpose, to prove the point.
//
// PROTECTED MODE: we explicitly set sameSite: "lax" (defensive -- never
// rely on a browser default) AND we remove the GET-based state change
// entirely AND we require a CSRF token on the POST. All three matter;
// see README.md "Why three layers?"
// ---------------------------------------------------------------------
app.use(
  session({
    secret: "csrf-demo-secret-do-not-use-in-real-apps",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: MODE === "protected" ? "lax" : undefined,
    },
  })
);

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function generateToken() {
  return crypto.randomBytes(24).toString("hex");
}

function page(title, body) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 60px auto; padding: 0 20px; color: #1a1a1a; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 6px; font-size: 13px; font-weight: 600; margin-bottom: 20px; }
    .vulnerable { background: #fde2e1; color: #b3261e; }
    .protected { background: #dcf5e3; color: #1e7d34; }
    input { padding: 8px; font-size: 14px; width: 100%; box-sizing: border-box; margin: 6px 0 14px; }
    button { padding: 10px 16px; font-size: 14px; background: #1a1a1a; color: white; border: none; border-radius: 6px; cursor: pointer; }
    button:hover { background: #333; }
    .flash { padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; font-size: 14px; }
    .flash.ok { background: #dcf5e3; color: #1e7d34; }
    code { background: #f2f2f2; padding: 2px 6px; border-radius: 4px; }
    a { color: #1a1a1a; }
  </style>
</head>
<body>
  <span class="badge ${MODE}">MODE: ${MODE.toUpperCase()}</span>
  ${body}
</body>
</html>`;
}

// ---------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------

app.get("/login", (req, res) => {
  res.send(
    page(
      "Login",
      `
    <h1>Demo Bank Login</h1>
    <p>No real credentials needed -- this just starts a session, like any login would.</p>
    <form method="POST" action="/login">
      <button type="submit">Log in as demo user</button>
    </form>
    `
    )
  );
});

app.post("/login", (req, res) => {
  req.session.user = "demo-user";
  req.session.email = "original@example.com";
  req.session.csrfToken = generateToken();
  res.redirect("/dashboard");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.get("/dashboard", requireLogin, (req, res) => {
  const csrfField =
    MODE === "protected"
      ? `<input type="hidden" name="csrfToken" value="${req.session.csrfToken}" />`
      : "";

  const getAttackNote =
    MODE === "vulnerable"
      ? `<p style="color:#b3261e; font-size: 13px;">This build also exposes <code>GET /account/email?email=...</code> as a state-changing endpoint -- a bad practice on its own, used here to prove the attack even though modern browsers already send this cookie same-site "Lax" by default.</p>`
      : "";

  res.send(
    page(
      "Dashboard",
      `
    <h1>Dashboard</h1>
    <p>Logged in as <strong>${req.session.user}</strong> | <a href="/logout">Log out</a></p>

    ${req.query.updated ? `<div class="flash ok">Email updated successfully.</div>` : ""}

    <p>Current account email: <strong>${req.session.email}</strong></p>

    <h3>Change email</h3>
    <form method="POST" action="/account/email">
      ${csrfField}
      <input type="email" name="email" placeholder="new-email@example.com" required />
      <button type="submit">Update email</button>
    </form>
    ${getAttackNote}
    `
    )
  );
});

// POST endpoint -- the "correct" way to expose a state change.
app.post("/account/email", requireLogin, (req, res) => {
  if (MODE === "protected") {
    const submittedToken = req.body.csrfToken;
    const sessionToken = req.session.csrfToken;
    if (!submittedToken || submittedToken !== sessionToken) {
      return res
        .status(403)
        .send(
          page(
            "Blocked",
            `<h1>403 Forbidden</h1><p>Missing or invalid CSRF token. This request was rejected.</p><p><a href="/dashboard">Back to dashboard</a></p>`
          )
        );
    }
  }

  const newEmail = req.body.email;
  if (!newEmail) return res.status(400).send("Missing email");

  req.session.email = newEmail;
  res.redirect("/dashboard?updated=1");
});

// GET endpoint -- ONLY registered in vulnerable mode. This is the actual
// bug: a state-changing action reachable by a simple link or <img> tag.
if (MODE === "vulnerable") {
  app.get("/account/email", requireLogin, (req, res) => {
    const newEmail = req.query.email;
    if (!newEmail) return res.status(400).send("Missing email");
    req.session.email = newEmail;
    res.redirect("/dashboard?updated=1");
  });
}

app.get("/", (req, res) => res.redirect("/dashboard"));

app.listen(PORT, () => {
  console.log(`\nCSRF demo running in ${MODE.toUpperCase()} mode`);
  console.log(`  App:      http://localhost:${PORT}/login`);
  console.log(`  Attacker: see /attacker-site (run its own server on a different host)\n`);
});