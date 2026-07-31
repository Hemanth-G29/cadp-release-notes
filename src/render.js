'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { release } = require('./config');
const defaults = require('./defaults');

const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'release-notes.html');

/** Escape text for safe HTML output. Subjects contain →, &, <, >, quotes. */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Section 5 as the { Bug ID | Description } table (v19+). `bugs` = [{id, subject}]. */
function renderBugTable(bugs) {
  const sorted = [...bugs].sort((a, b) => a.id - b.id);
  const rows = sorted
    .map(b => `    <tr><td>${b.id}</td><td>${esc(b.subject)}</td></tr>`)
    .join('\n');
  return `<table class="bugid-table">
  <thead>
    <tr><th>Bug ID</th><th>Description</th></tr>
  </thead>
  <tbody>
${rows || '    <tr><td>—</td><td>No fixed bugs recorded yet for this release.</td></tr>'}
  </tbody>
</table>`;
}

/** Section 5 as the legacy single-cell comma-joined list (v18 and earlier). */
function renderBugList(bugs) {
  const ids = [...bugs].map(b => b.id).sort((a, b) => a - b);
  const grouped = [];
  for (let i = 0; i < ids.length; i += 10) grouped.push(ids.slice(i, i + 10).join(', '));
  const body = grouped.join(',\n        ') || '—';
  return `<table class="bugfix-table">
  <tr>
    <td>Bug IDs</td>
    <td>${body}</td>
  </tr>
</table>`;
}

function renderFeatureRows(features) {
  if (!features || features.length === 0) return defaults.NONE_FEATURE_ROW;
  return features
    .map(f => `    <tr><td>${esc(f.id || '')}</td><td>${esc(f.name)}</td><td>${esc(f.description)}</td><td>${esc(f.impact || '')}</td></tr>`)
    .join('\n');
}

function renderEnhancementRows(enhancements) {
  if (!enhancements || enhancements.length === 0) return defaults.NONE_ENHANCEMENT_ROW;
  return enhancements
    .map(e => `    <tr><td>${esc(e.id || '')}</td><td>${esc(e.module)}</td><td>${esc(e.description)}</td><td>${esc(e.benefit || '')}</td></tr>`)
    .join('\n');
}

function renderKnownIssueRows(issues) {
  const rows = issues && issues.length ? issues : defaults.DEFAULT_KNOWN_ISSUES;
  return rows
    .map(([id, desc, workaround]) => `    <tr><td>${esc(id)}</td><td>${esc(desc)}</td><td>${esc(workaround)}</td></tr>`)
    .join('\n');
}

/** Compose a real summary of the document from its actual contents. */
function buildSummary(model) {
  const version = model.version;
  const B = (model.bugs || []).length;
  const F = (model.features || []).length;
  const E = (model.enhancements || []).length;
  const plural = (n, s) => `${n} ${s}${n === 1 ? '' : 's'}`;

  const parts = [plural(B, 'bug fix').replace('fixs', 'fixes')];
  if (F) parts.push(plural(F, 'new feature'));
  if (E) parts.push(plural(E, 'enhancement'));
  const list = parts.length > 1
    ? `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
    : parts[0];

  let s = `This release of CADP Workspace Version 1.0.0 (${version}) delivers ${list} across the platform.`;

  const names = (model.features || []).slice(0, 3).map(f => f.name).filter(Boolean).map(esc);
  if (names.length) {
    const hl = names.length > 1 ? `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}` : names[0];
    s += ` Highlights include ${hl}.`;
  }

  const notes = [];
  if ((model.configChanges || []).length) notes.push('a required configuration change (see Configuration Changes)');
  if ((model.apiChanges || []).length) notes.push('API changes (see API Changes)');
  if (notes.length) {
    s += ` It also includes ${notes.join(' and ')}.`;
  }
  s += ` Refer to the Known Issues section for current limitations.`;
  return `<p>${s}</p>`;
}

/** Baseline What-to-Test checklist, plus any per-release additions (from `test`-tagged entries). */
function renderWhatToTest(model) {
  const base = model.whatToTestHtml || defaults.WHAT_TO_TEST_HTML;
  const adds = model.whatToTest;
  if (!adds || adds.length === 0) return base;
  const items = adds.map(t => `  <li>${esc(t)}</li>`).join('\n');
  return `${base}\n<p><strong>This build — additional test focus:</strong></p>\n<ul>\n${items}\n</ul>`;
}

/** Generic 3-column table body with a "None" fallback row. */
function renderTripleRows(rows, noneCells) {
  if (!rows || rows.length === 0) {
    return `    <tr>${noneCells.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`;
  }
  return rows
    .map(([a, b, c]) => `    <tr><td>${esc(a)}</td><td>${esc(b)}</td><td>${esc(c)}</td></tr>`)
    .join('\n');
}

/**
 * Render a release-notes HTML document from a model:
 *   { version, releaseDate, summaryHtml?, features?, enhancements?, knownIssues?, bugs,
 *     draft?, whatToTestHtml?, whatToTestMobileHtml? }
 * `bugs` = [{ id, subject }].
 */
function render(model) {
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const version = model.version;
  const useTable = version >= release.bugTableFromVersion;

  const summaryHtml = model.summaryHtml || buildSummary(model);

  const draftBanner = model.draft
    ? `<div class="draft-banner">DRAFT — live release notes for BUILD ${version}. ` +
      `Bug fixes update automatically; New Features / Enhancements / Known Issues are pending review before this build is cut.</div>`
    : '';

  const bugFixes = useTable ? renderBugTable(model.bugs || []) : renderBugList(model.bugs || []);

  const replacements = {
    '{{TITLE}}': esc(`Release Notes – CADP Workspace v1.0.0 (${version})`),
    '{{DRAFT_BANNER}}': draftBanner,
    '{{VERSION}}': String(version),
    '{{RELEASE_DATE}}': esc(model.releaseDate || ''),
    '{{SUMMARY}}': summaryHtml,
    '{{NEW_FEATURES_ROWS}}': renderFeatureRows(model.features),
    '{{ENHANCEMENTS_ROWS}}': renderEnhancementRows(model.enhancements),
    '{{BUG_FIXES}}': bugFixes,
    '{{KNOWN_ISSUES_ROWS}}': renderKnownIssueRows(model.knownIssues),
    '{{CONFIG_CHANGES_ROWS}}': renderTripleRows(model.configChanges, ['None', 'No configuration changes are required for this release.', 'N/A']),
    '{{API_CHANGES_ROWS}}': renderTripleRows(model.apiChanges, ['None', 'N/A', 'No API changes are included in this release.']),
    '{{WHAT_TO_TEST}}': renderWhatToTest(model),
    '{{WHAT_TO_TEST_MOBILE}}': model.whatToTestMobileHtml || defaults.WHAT_TO_TEST_MOBILE_HTML,
  };

  let html = template;
  for (const [k, v] of Object.entries(replacements)) {
    html = html.split(k).join(v);
  }
  return html;
}

module.exports = { render, esc, renderBugTable, renderBugList };
