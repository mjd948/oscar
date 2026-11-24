// Try a viewer build against a running node without deploying it: serves the static export
// (WEB_DIR) on https://localhost:PORT and forwards everything else (sign-in, API, MQTT websocket,
// video) to the node's gateway (UP_HOST:UP_PORT). A page document is served from WEB_DIR only
// after the same request passes the node's auth, so the node's own sign-in still applies. Nothing
// on the node changes; page layouts live in the test browser's own storage.
//   openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 2 -subj /CN=localhost
//   WEB_DIR=<repo>/web/oscar-viewer/web TLS_KEY=key.pem TLS_CERT=cert.pem node verify-proxy.mjs
//   OSCAR_BASE=https://localhost:9443 PW_FILE=... node check-main-pages.mjs
import https from 'node:https';
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';

const WEB_DIR = process.env.WEB_DIR;
const PORT = Number(process.env.PORT ?? 9443);
const UP_HOST = process.env.UP_HOST ?? '127.0.0.1';
const UP_PORT = Number(process.env.UP_PORT ?? 443);
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4', '.wasm': 'application/wasm'};

function localFile(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath); } catch { return null; }
  if (p.includes('..')) return null;
  const file = path.join(WEB_DIR, p.endsWith('/') ? p + 'index.html' : p);
  try { return fs.statSync(file).isFile() ? file : null; } catch { return null; }
}
function serveLocal(res, file) {
  res.writeHead(200, {'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store'});
  fs.createReadStream(file).pipe(res);
}
function upstream(req, res, onOk) {
  const up = https.request({host: UP_HOST, port: UP_PORT, method: req.method, path: req.url, headers: req.headers, rejectUnauthorized: false}, (r) => {
    // Passed the node's auth: anything but a challenge, a refusal or a redirect (to the login page).
    if (onOk && ![401, 403].includes(r.statusCode) && !(r.statusCode >= 300 && r.statusCode < 400)) { r.resume(); onOk(); return; }
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(up);
}

const server = https.createServer({key: fs.readFileSync(process.env.TLS_KEY), cert: fs.readFileSync(process.env.TLS_CERT)}, (req, res) => {
  const url = new URL(req.url, 'https://x');
  if (req.method === 'GET' && !url.pathname.startsWith('/sensorhub')) {
    // Directory without its trailing slash: the static server redirects, as OSCAR's does.
    if (!url.pathname.endsWith('/') && localFile(url.pathname + '/')) {
      res.writeHead(308, {location: url.pathname + '/' + url.search}); res.end(); return;
    }
    const file = localFile(url.pathname);
    if (file) {
      if (url.pathname.startsWith('/_next/')) { serveLocal(res, file); return; }
      upstream(req, res, () => serveLocal(res, file));
      return;
    }
  }
  upstream(req, res);
});
server.on('upgrade', (req, socket, head) => {
  const up = tls.connect({host: UP_HOST, port: UP_PORT, rejectUnauthorized: false, ALPNProtocols: ['http/1.1']}, () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    up.write(lines.join('\r\n') + '\r\n\r\n');
    if (head?.length) up.write(head);
    up.pipe(socket); socket.pipe(up);
  });
  const close = () => { up.destroy(); socket.destroy(); };
  up.on('error', close); socket.on('error', close);
});
server.listen(PORT, () => console.log(`verify proxy on https://localhost:${PORT} -> ${UP_HOST}:${UP_PORT}, web=${WEB_DIR}`));
