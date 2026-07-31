'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * OPTIONAL human-edited content manifests, for release-note items that are NOT tied to a code
 * change (so they have no `docs/changes` entry) — e.g. long-standing known issues, or an
 * environment/config note. Each is a plain Markdown table a human (or Claude Code) edits:
 *
 *   content/known-issues.md    | Issue ID | Description | Workaround |
 *   content/api-changes.md     | API Name | Type | Description |
 *   content/config-changes.md  | Configuration | Description | Impact |
 *
 * Missing file → empty (the tag-driven aggregator + baseline defaults still apply). Rows are
 * returned as 3-cell triples matching the template columns.
 */

function parseTable(md) {
  const tableLines = md.split('\n').map(l => l.trim()).filter(l => l.startsWith('|'));
  const rows = [];
  for (const line of tableLines) {
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length && cells.every(c => /^:?-{2,}:?$/.test(c))) continue; // separator row
    rows.push(cells);
  }
  // First remaining row is the header — drop it. Normalise to exactly 3 cells.
  return rows.slice(1).map(r => [r[0] || '', r[1] || '', r[2] || '']);
}

function readOne(dir, file) {
  try { return parseTable(fs.readFileSync(path.join(dir, file), 'utf8')); }
  catch { return []; }
}

function readContent(dir) {
  const base = dir || path.join(__dirname, '..', 'content');
  // new-features.md   → | Feature Name | Description | Impact |
  // enhancements.md   → | Module | Description | Benefit |
  const features = readOne(base, 'new-features.md').map(([name, description, impact]) => ({
    id: '', name, description, impact,
  }));
  const enhancements = readOne(base, 'enhancements.md').map(([module, description, benefit]) => ({
    id: '', module, description, benefit,
  }));
  return {
    features,
    enhancements,
    knownIssues: readOne(base, 'known-issues.md'),
    apiChanges: readOne(base, 'api-changes.md'),
    configChanges: readOne(base, 'config-changes.md'),
  };
}

module.exports = { readContent, parseTable };
