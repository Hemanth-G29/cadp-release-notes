'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Narrative aggregator: derive New Features / Enhancements / What-to-Test from the platform's
 * per-commit `docs/changes/<module>.md` entries.
 *
 * Entry shape (existing convention):
 *   ## YYYY-MM-DD — <title>
 *   - **Author:** ...
 *   - **What:** ...            (may span nested bullets)
 *   - **Why:** ...
 *   - **QA-Release-Note:** feature | enhancement | test | none   (NEW; default none)
 *   - **Files:** ...
 *
 * Only entries dated >= cutoff with a non-`none` QA-Release-Note tag are surfaced.
 *
 * NOTE: the tag is `QA-Release-Note` (not `Release-Note`) to keep these internal QA/build release
 * notes clearly separate from the in-app "Release Notes" product feature. The legacy `Release-Note`
 * spelling is still accepted for backward compatibility.
 */

const HEADING = /^##\s+(\d{4}-\d{2}-\d{2})\s*[—–-]\s*(.+?)\s*$/;

/** Grab a `- **Field:**` value: text after the marker until the next top-level `- **` bullet. */
function extractField(block, name) {
  const re = new RegExp(`- \\*\\*${name}:\\*\\*([\\s\\S]*?)(?=\\n- \\*\\*|$)`, 'i');
  const m = re.exec(block);
  if (!m) return '';
  return m[1]
    .replace(/\r/g, '')
    .split('\n')
    .map(l => l.replace(/^\s*[-*]\s*/, '').trim())
    .filter(Boolean)
    .join('; ')
    .trim();
}

/** Parse one changelog file's markdown into structured entries. */
function parseEntries(md, moduleName) {
  const lines = md.split('\n');
  const entries = [];
  let cur = null;
  const flush = () => { if (cur) { cur.block = cur.blockLines.join('\n'); entries.push(cur); cur = null; } };

  for (const line of lines) {
    const h = HEADING.exec(line);
    if (h) {
      flush();
      cur = { date: h[1], title: h[2], module: moduleName, blockLines: [] };
    } else if (/^#\s/.test(line) || /^##\s/.test(line)) {
      // a different heading level ends the current entry
      flush();
    } else if (cur) {
      cur.blockLines.push(line);
    }
  }
  flush();

  return entries.map(e => ({
    date: e.date,
    title: e.title,
    module: e.module,
    author: extractField(e.block, 'Author'),
    what: extractField(e.block, 'What'),
    why: extractField(e.block, 'Why'),
    releaseNote: (extractField(e.block, 'QA-Release-Note') || extractField(e.block, 'Release-Note') || 'none')
      .toLowerCase().split(/[\s;]/)[0],
  }));
}

const REPO_DIRS = [
  'Services/cadp_master_backend_nodejs',
  'Services/cadp_rbac_backend_nodejs',
  'Services/cadp_client_ws_backend_nodejs',
  'Services/cadp_clientws_metadata_backend_nodejs',
  'Services/cadp_workflow_backend_nodejs',
  'Services/cadp_notification_backend_nodejs',
  'Services/cadp_chat_backend_nodejs',
  'Services/cadp_platform_search_backend_nodejs',
  'Services/cadp_template_backend_nodejs',
  'cadp_frontend_reactjs',
];

/** Find all docs/changes/*.md files under the known repos below `root`. */
function findChangeFiles(root) {
  const files = [];
  for (const repo of REPO_DIRS) {
    const dir = path.join(root, repo, 'docs', 'changes');
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (n.endsWith('.md') && n.toLowerCase() !== 'index.md') {
        files.push({ path: path.join(dir, n), module: n.replace(/\.md$/, '') });
      }
    }
  }
  return files;
}

/**
 * Aggregate narrative from changelog files.
 * opts: { root, sinceIso, files? }  (files = [{path, module}] override for testing)
 * Returns { features[], enhancements[], whatToTest[], counts, scannedFiles }.
 */
function aggregate({ root, sinceIso, files } = {}) {
  const changeFiles = files || findChangeFiles(root || path.join(__dirname, '..', '..'));
  const sinceDate = sinceIso ? sinceIso.slice(0, 10) : '0000-00-00';

  const all = [];
  for (const f of changeFiles) {
    let md;
    try { md = fs.readFileSync(f.path, 'utf8'); } catch { continue; }
    for (const e of parseEntries(md, f.module)) all.push(e);
  }

  const TAGS = ['feature', 'enhancement', 'test', 'known-issue', 'api', 'config'];
  const tagged = all.filter(e => e.date >= sinceDate && TAGS.includes(e.releaseNote));
  const of = tag => tagged.filter(e => e.releaseNote === tag);

  const features = of('feature').map(e => ({
    id: '', name: e.title, description: e.what || e.title, impact: e.why || '',
  }));
  const enhancements = of('enhancement').map(e => ({
    id: '', module: e.module, description: e.what || e.title, benefit: e.why || '',
  }));
  const whatToTest = of('test').map(e => `${e.title}${e.what ? ` — ${e.what}` : ''}`);
  // Table sections are triples matching the template columns.
  const knownIssues = of('known-issue').map(e => ['', e.what ? `${e.title} — ${e.what}` : e.title, e.why || '']);
  const apiChanges = of('api').map(e => [e.title, '', e.what || '']);
  const configChanges = of('config').map(e => [e.title, e.what || '', e.why || '']);

  return {
    features,
    enhancements,
    whatToTest,
    knownIssues,
    apiChanges,
    configChanges,
    counts: { scanned: all.length, tagged: tagged.length, files: changeFiles.length },
    scannedFiles: changeFiles.map(f => f.module),
  };
}

module.exports = { aggregate, parseEntries, extractField, findChangeFiles };
