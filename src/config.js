'use strict';

/**
 * Central config. Everything is env-driven; NO secrets are committed to this repo.
 *
 * Locally, put OPENPROJECT_TOKEN (and any Graph creds) in a gitignored `.env` file — loaded below.
 * In GitHub Actions they come from repo Secrets. `.env.example` documents every key.
 */

// Minimal .env loader (no dependency): fill process.env from a gitignored ./.env if present.
(function loadDotEnv() {
  try {
    const txt = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '.env'), 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
      }
    }
  } catch { /* no .env — rely on real env vars */ }
})();

function envInt(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

const openprojectToken = process.env.OPENPROJECT_TOKEN || '';
if (!openprojectToken) {
  console.warn('[config] OPENPROJECT_TOKEN not set (env or .env) — OpenProject calls will fail. Set it locally in .env and in GitHub Actions Secrets.');
}

module.exports = {
  openproject: {
    host: process.env.OPENPROJECT_HOST || 'pmt.cavininfotech.com',
    token: openprojectToken,
    projectId: envInt('OPENPROJECT_PROJECT_ID', 3),
  },

  // Work-package type + status IDs (from the existing open-project scripts).
  ids: {
    TYPE_BUG: 7,
    STATUS_NEW: 1,
    STATUS_IN_PROGRESS: 7,
    STATUS_DEVELOPED: 8,
    STATUS_IN_TESTING: 9,
    STATUS_TEST_PASSED: 10,
    STATUS_TEST_FAILED: 11,
    STATUS_CLOSED: 12,
    STATUS_REOPEN: 15,
    STATUS_READY_FOR_TESTING: 16,
  },

  release: {
    cutoffIso: process.env.RELEASE_CUTOFF_ISO || '',
    liveVersion: envInt('LIVE_VERSION', 19),
    // Section 5 becomes the { Bug ID | Description } table from this version onward.
    bugTableFromVersion: 19,
  },

  store: {
    // local (dev, ./out) | pages (GitHub Pages site dir) | gcs (Cloud Run)
    backend: (process.env.STORE_BACKEND || 'local').toLowerCase(),
    gcsBucket: process.env.GCS_BUCKET || '',
    siteDir: process.env.SITE_DIR || 'site',
  },

  graph: {
    tenantId: process.env.GRAPH_TENANT_ID || '',
    clientId: process.env.GRAPH_CLIENT_ID || '',
    clientSecret: process.env.GRAPH_CLIENT_SECRET || '',
    mailbox: process.env.GRAPH_MAILBOX || 'hemanth.a@hepl.com',
    releaseMailSubject: process.env.RELEASE_MAIL_SUBJECT || 'CADP - QA Release',
    // Body version signal, e.g. "Release Notes V1.0.0 (18)".
    versionRegex: /Release\s+Notes\s+V?\s*1\.0\.0\s*\(\s*(\d+)\s*\)/i,
  },

  git: {
    apiBase: process.env.GIT_API_BASE || '',
    readToken: process.env.GIT_READ_TOKEN || '',
  },

  // Narrative sources: CHANGELOG_ROOT = a checkout root containing the repos' docs/changes;
  // CONTENT_DIR = optional human-edited manifests (known-issues/api-changes/config-changes).
  narrative: {
    changelogRoot: process.env.CHANGELOG_ROOT || '',
    contentDir: process.env.CONTENT_DIR || 'content',
  },

  server: {
    port: envInt('PORT', 8080),
    controlToken: process.env.CONTROL_TOKEN || '',
  },
};
