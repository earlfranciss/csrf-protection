/**
 * Tiny static file server, no dependencies, just to host attack.html.
 *
 * Run it bound to 127.0.0.1 while the main app runs on localhost --
 * browsers treat "localhost" and "127.0.0.1" as different sites, which
 * is what makes this a genuine cross-site test instead of two ports on
 * the same site (ports alone don't count as cross-site).
 *
 * Usage:
 *   node serve.js            (defaults to port 5500)
 *   PORT=5555 node serve.js  (custom port, e.g. if 5500 is taken)
 *
 * Then open: http://127.0.0.1:<port>/attack.html
 *
 * Windows note: if you get "EACCES: permission denied" on a port that
 * looks otherwise unused, this is almost always Windows' dynamic
 * "excluded port range" (used by Hyper-V/WSL), not an actual permissions
 * problem. Just pick a different port with PORT=xxxx above -- no need
 * to run as Administrator. You can check your excluded ranges with:
 *   netsh interface ipv4 show excludedportrange protocol=tcp
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 5500;
const HOST = "127.0.0.1";

const server = http.createServer((req, res) => {
  const filePath = req.url === "/" ? "/attack.html" : req.url;
  const fullPath = path.join(__dirname, filePath);

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(data);
  });
});

server.on("error", (err) => {
  if (err.code === "EACCES" || err.code === "EADDRINUSE") {
    console.error(`\nCouldn't bind to port ${PORT} (${err.code}).`);
    console.error(`This is usually just a busy/reserved port, not a real permissions issue.`);
    console.error(`Try a different port, e.g.:  PORT=5555 node serve.js`);
    console.error(`(Windows PowerShell:  $env:PORT=5555; node serve.js)\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`\nAttacker site running at http://${HOST}:${PORT}/attack.html\n`);
});