'use strict';
// Plain Node server for Render (or local use): serves index.html and POST /api/agent.
// Run: node server.js   (needs Node 18 or newer, no npm packages)
const http = require('http');
const fs = require('fs');
const path = require('path');

// Load .env when running locally (Render and Vercel inject env vars themselves).
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (e) { /* no .env file */ }

const { handle } = require('./api/_core');
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'POST' && url === '/api/agent') {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 60000) req.destroy(); });
    req.on('end', async () => {
      let body = null;
      try { body = JSON.parse(raw || '{}'); } catch (e) { /* bad JSON */ }
      const out = await handle(body || {});
      res.writeHead(out.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out.json));
    });
    return;
  }
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    if (process.env.LOG_VISITS) console.log('[visit] ' + req.headers.host + req.url + ' | ' + req.headers['user-agent']);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
    return;
  }
  if (url === '/healthz') { res.writeHead(200); res.end('ok'); return; }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Not found');
}).listen(PORT, () => console.log('Voice assistant demo running on http://localhost:' + PORT));
