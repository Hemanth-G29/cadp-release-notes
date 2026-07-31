'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');
const { store, release } = require('./config');

/**
 * Persistence for the state doc + per-version HTML snapshots.
 *
 * Two interchangeable backends behind one interface:
 *   - local : files under ./out (dev; fully exercised here)
 *   - gcs   : Google Cloud Storage JSON API using the Cloud Run metadata-server token
 *             (zero extra dependencies; runs on Cloud Run without the @google-cloud SDK)
 *
 * Interface (all async):
 *   readState() -> state object (defaults if absent)
 *   writeState(state)
 *   readBuild(version) -> html | null
 *   writeBuild(version, html)
 *   listVersions() -> number[]
 */

function defaultState() {
  return {
    liveVersion: release.liveVersion,
    latestAnnouncedVersion: release.liveVersion - 1,
    lastProcessedMailId: null,
    lastCutAt: release.cutoffIso || null,
    bugs: [],
    overview: {},
    narrative: { features: [], enhancements: [], knownIssues: [], whatToTest: [] },
    approvedAt: null,
  };
}

const buildName = v => `Release_Notes_V1.0.0_BUILD${v}.html`;

/* ----------------------------- local backend ----------------------------- */

function localStore(baseDir) {
  const buildsDir = path.join(baseDir, 'builds');
  const statePath = path.join(baseDir, 'state.json');

  async function ensure() {
    await fsp.mkdir(buildsDir, { recursive: true });
  }

  return {
    async readState() {
      try {
        return JSON.parse(await fsp.readFile(statePath, 'utf8'));
      } catch {
        return defaultState();
      }
    },
    async writeState(state) {
      await ensure();
      await fsp.writeFile(statePath, JSON.stringify(state, null, 2));
    },
    async readBuild(version) {
      try {
        return await fsp.readFile(path.join(buildsDir, buildName(version)), 'utf8');
      } catch {
        return null;
      }
    },
    async writeBuild(version, html) {
      await ensure();
      await fsp.writeFile(path.join(buildsDir, buildName(version)), html);
    },
    async listVersions() {
      try {
        return fs.readdirSync(buildsDir)
          .map(f => (f.match(/BUILD(\d+)\.html$/) || [])[1])
          .filter(Boolean)
          .map(Number)
          .sort((a, b) => a - b);
      } catch {
        return [];
      }
    },
  };
}

/* ------------------------------ gcs backend ------------------------------- */

function fetchJson(options, body) {
  return new Promise((resolve, reject) => {
    const lib = options.protocol === 'http:' ? http : https;
    const req = lib.request(options, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function metadataToken() {
  const { status, body } = await fetchJson({
    protocol: 'http:',
    hostname: 'metadata.google.internal',
    path: '/computeMetadata/v1/instance/service-accounts/default/token',
    method: 'GET',
    headers: { 'Metadata-Flavor': 'Google' },
  });
  if (status !== 200) throw new Error(`metadata token failed: HTTP ${status}`);
  return JSON.parse(body).access_token;
}

function gcsStore(bucket) {
  const STATE_OBJ = 'state.json';
  const buildObj = v => `builds/${buildName(v)}`;

  async function getObject(name) {
    const token = await metadataToken();
    const { status, body } = await fetchJson({
      hostname: 'storage.googleapis.com',
      path: `/storage/v1/b/${bucket}/o/${encodeURIComponent(name)}?alt=media`,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (status === 404) return null;
    if (status < 200 || status >= 300) throw new Error(`GCS get ${name}: HTTP ${status}`);
    return body;
  }

  async function putObject(name, content, contentType) {
    const token = await metadataToken();
    const { status, body } = await fetchJson({
      hostname: 'storage.googleapis.com',
      path: `/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(name)}`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType,
        'Content-Length': Buffer.byteLength(content),
      },
    }, content);
    if (status < 200 || status >= 300) throw new Error(`GCS put ${name}: HTTP ${status} ${body.slice(0, 200)}`);
  }

  async function listBuilds() {
    const token = await metadataToken();
    const { status, body } = await fetchJson({
      hostname: 'storage.googleapis.com',
      path: `/storage/v1/b/${bucket}/o?prefix=builds/`,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (status < 200 || status >= 300) throw new Error(`GCS list: HTTP ${status}`);
    const items = JSON.parse(body).items || [];
    return items
      .map(o => (o.name.match(/BUILD(\d+)\.html$/) || [])[1])
      .filter(Boolean)
      .map(Number)
      .sort((a, b) => a - b);
  }

  return {
    async readState() {
      const raw = await getObject(STATE_OBJ);
      return raw ? JSON.parse(raw) : defaultState();
    },
    writeState(state) { return putObject(STATE_OBJ, JSON.stringify(state, null, 2), 'application/json'); },
    readBuild(version) { return getObject(buildObj(version)); },
    writeBuild(version, html) { return putObject(buildObj(version), html, 'text/html; charset=utf-8'); },
    listVersions() { return listBuilds(); },
  };
}

/* ------------------------------ pages backend ----------------------------- */
/**
 * Publishes a static site consumable by GitHub Pages:
 *   <base>/state.json
 *   <base>/release-notes-v<N>/index.html   (each build; URL → /release-notes-v<N>/)
 *   <base>/index.html                      (redirects to the latest build)
 * The workflow commits <base> back to the repo (durable archive + state) and deploys it to Pages.
 */
function pagesStore(baseDir) {
  const statePath = path.join(baseDir, 'state.json');
  const verDir = v => path.join(baseDir, `release-notes-v${v}`);

  return {
    async readState() {
      try { return JSON.parse(await fsp.readFile(statePath, 'utf8')); } catch { return defaultState(); }
    },
    async writeState(state) {
      await fsp.mkdir(baseDir, { recursive: true });
      await fsp.writeFile(statePath, JSON.stringify(state, null, 2));
    },
    async readBuild(version) {
      try { return await fsp.readFile(path.join(verDir(version), 'index.html'), 'utf8'); } catch { return null; }
    },
    async writeBuild(version, html) {
      await fsp.mkdir(verDir(version), { recursive: true });
      await fsp.writeFile(path.join(verDir(version), 'index.html'), html);
    },
    async listVersions() {
      try {
        return fs.readdirSync(baseDir)
          .map(f => (f.match(/^release-notes-v(\d+)$/) || [])[1])
          .filter(Boolean).map(Number).sort((a, b) => a - b);
      } catch { return []; }
    },
    async pdfExists(version) {
      try { await fsp.access(path.join(verDir(version), 'index.pdf')); return true; } catch { return false; }
    },
    async writePdf(version, buffer) {
      await fsp.mkdir(verDir(version), { recursive: true });
      await fsp.writeFile(path.join(verDir(version), 'index.pdf'), buffer);
    },
    async writeLatestPdf(buffer) {
      await fsp.mkdir(baseDir, { recursive: true });
      await fsp.writeFile(path.join(baseDir, 'latest.pdf'), buffer);
    },
    // Redirect page at the site root → newest build. Relative href so it works under /<repo>/.
    async writeLatestIndex(version) {
      await fsp.mkdir(baseDir, { recursive: true });
      const target = `./release-notes-v${version}/`;
      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
        `<title>CADP QA Build Release Notes</title>` +
        `<meta http-equiv="refresh" content="0; url=${target}">` +
        `<link rel="canonical" href="${target}"></head>` +
        `<body>Redirecting to the latest release notes → <a href="${target}">${target}</a></body></html>\n`;
      await fsp.writeFile(path.join(baseDir, 'index.html'), html);
      // .nojekyll so GitHub Pages serves the folders verbatim (no Jekyll processing).
      await fsp.writeFile(path.join(baseDir, '.nojekyll'), '');
    },
  };
}

/* ------------------------------- factory --------------------------------- */

function createStore() {
  if (store.backend === 'gcs') {
    if (!store.gcsBucket) throw new Error('STORE_BACKEND=gcs but GCS_BUCKET is not set');
    return gcsStore(store.gcsBucket);
  }
  if (store.backend === 'pages') {
    return pagesStore(path.isAbsolute(store.siteDir) ? store.siteDir : path.join(__dirname, '..', store.siteDir));
  }
  return localStore(path.join(__dirname, '..', 'out'));
}

module.exports = { createStore, defaultState };
