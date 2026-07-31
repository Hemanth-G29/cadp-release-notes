'use strict';

const http = require('node:http');
const { server: serverCfg } = require('./config');
const { createStore } = require('./store');
const svc = require('./service');
const { performRollover, summaryText } = require('./rollover');
const mailwatch = require('./mailwatch');
const { htmlToPdf } = require('./pdf');

const store = createStore();

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}
function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj, null, 2), { 'Content-Type': 'application/json; charset=utf-8' });
}

/** Control routes require the shared token (Cloud Scheduler → Cloud Run; use OIDC in prod). */
function authorized(req) {
  if (!serverCfg.controlToken) return true; // open in dev when unset
  const hdr = req.headers['authorization'] || req.headers['x-control-token'] || '';
  const token = hdr.replace(/^Bearer\s+/i, '');
  return token === serverCfg.controlToken;
}

function readBody(req) {
  return new Promise(resolve => {
    let d = '';
    req.on('data', c => (d += c));
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
  });
}

function baseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['host'] || '';
  return `${proto}://${host}`;
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/healthz') return send(res, 200, 'ok');

  // Default → latest
  if (p === '/' || p === '') {
    const latest = await svc.latestVersion(store);
    return send(res, 302, `redirecting to /release-notes-v${latest}/`, { Location: `/release-notes-v${latest}/` });
  }

  // Versioned pages: /release-notes-v<N>/ and /release-notes-v<N>/current.pdf
  const vmatch = p.match(/^\/release-notes-v(\d+)\/?(current\.pdf)?$/);
  if (vmatch) {
    const version = Number(vmatch[1]);
    const wantsPdf = Boolean(vmatch[2]);
    const html = await svc.getVersionHtml(store, version);
    if (html == null) return send(res, 404, `No release notes for v${version}`);
    if (!wantsPdf) return send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8' });
    try {
      const pdf = await htmlToPdf(html);
      return res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="Release_Notes_V1.0.0_BUILD${version}.pdf"`,
      }), res.end(pdf);
    } catch (e) {
      return send(res, e.code === 'PDF_UNAVAILABLE' ? 501 : 500, e.message);
    }
  }

  if (req.method === 'POST' && p === '/tick') {
    if (!authorized(req)) return send(res, 401, 'unauthorized');
    const summary = await svc.tickReconcile(store);
    let rollover = null;
    try {
      rollover = await mailwatch.checkAndRollover({ store });
    } catch (e) {
      rollover = { error: e.message };
    }
    return sendJson(res, 200, { ok: true, reconcile: summary, rollover });
  }

  if (req.method === 'POST' && p === '/rollover') {
    if (!authorized(req)) return send(res, 401, 'unauthorized');
    const body = await readBody(req);
    const audit = await performRollover(
      { store, releaseDate: body.releaseDate, cutoffIso: body.cutoffIso, mailId: body.mailId, tz: body.tz },
      { dryRun: Boolean(body.dryRun) }
    );
    audit.summary = summaryText(audit, baseUrl(req));
    return sendJson(res, 200, audit);
  }

  if (req.method === 'POST' && p === '/approve') {
    if (!authorized(req)) return send(res, 401, 'unauthorized');
    const body = await readBody(req);
    const state = await store.readState();
    const narrative = { ...state.narrative, ...(body.narrative || {}) };
    await store.writeState({ ...state, narrative, approvedAt: new Date().toISOString() });
    return sendJson(res, 200, { ok: true, approvedAt: new Date().toISOString(), narrative });
  }

  return send(res, 404, 'not found');
}

const httpServer = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    console.error('[server] error:', err);
    send(res, 500, `error: ${err.message}`);
  });
});

if (require.main === module) {
  httpServer.listen(serverCfg.port, () => {
    console.log(`cadp-release-notes listening on :${serverCfg.port} (store: ${require('./config').store.backend})`);
  });
}

module.exports = { httpServer, handle };
