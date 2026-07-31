'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseVersion } = require('../src/mailwatch');
const { render } = require('../src/render');
const { parseEntries, extractField, aggregate } = require('../src/changelog');
const { parseTable } = require('../src/content');

test('parseVersion reads the build number from the release-mail body', () => {
  assert.strictEqual(parseVersion('Please find attached Release Notes V1.0.0 (18) for the release.'), 18);
  assert.strictEqual(parseVersion('release notes v1.0.0(20)'), 20);
  assert.strictEqual(parseVersion('Release  Notes  V 1.0.0 ( 7 )'), 7);
  assert.strictEqual(parseVersion('no version here'), null);
});

test('render: v19+ uses the Bug ID | Description table; v18 uses the legacy comma list', () => {
  const bugs = [{ id: 531, subject: 'b' }, { id: 371, subject: 'a' }];
  const v19 = render({ version: 19, releaseDate: 'x', bugs });
  const v18 = render({ version: 18, releaseDate: 'x', bugs });
  assert.ok(v19.includes('<table class="bugid-table">'));
  assert.ok(!v19.includes('<table class="bugfix-table">'));
  assert.ok(v18.includes('<table class="bugfix-table">'));
  assert.ok(!v18.includes('<table class="bugid-table">'));
  // sorted ascending in the table
  assert.ok(v19.indexOf('<td>371</td>') < v19.indexOf('<td>531</td>'));
});

test('render escapes bug subjects (no injection)', () => {
  const html = render({ version: 19, releaseDate: 'x', bugs: [{ id: 1, subject: 'A < B & <script>x</script> "q"' }] });
  assert.ok(html.includes('A &lt; B &amp; &lt;script&gt;x&lt;/script&gt; &quot;q&quot;'));
  assert.ok(!html.includes('<script>x</script>'));
});

test('changelog parseEntries extracts date, title, and QA-Release-Note tag', () => {
  const md = [
    '# Mod — Change Log', '',
    '## 2026-07-15 — Canvas import',
    '- **Author:** a@b.com',
    '- **What:** Import canvas configs from Excel or JSON',
    '- **QA-Release-Note:** feature',
    '- **Files:**', '  - src/x.js',
  ].join('\n');
  const [e] = parseEntries(md, 'mod');
  assert.strictEqual(e.date, '2026-07-15');
  assert.strictEqual(e.title, 'Canvas import');
  assert.strictEqual(e.releaseNote, 'feature');
  assert.ok(e.what.includes('Import canvas configs'));
});

test('legacy Release-Note tag is still accepted', () => {
  const md = '## 2026-07-15 — X\n- **Release-Note:** enhancement\n';
  assert.strictEqual(parseEntries(md, 'mod')[0].releaseNote, 'enhancement');
});

test('extractField stops at the next field bullet', () => {
  const block = '- **What:** first line\n- **Why:** reason';
  assert.strictEqual(extractField(block, 'What'), 'first line');
  assert.strictEqual(extractField(block, 'Why'), 'reason');
});

test('aggregate routes all six QA-Release-Note tag types', () => {
  const md = [
    '# M — Change Log', '',
    '## 2026-07-15 — Feat', '- **What:** a', '- **QA-Release-Note:** feature', '',
    '## 2026-07-15 — Enh', '- **What:** b', '- **QA-Release-Note:** enhancement', '',
    '## 2026-07-15 — Tst', '- **What:** c', '- **QA-Release-Note:** test', '',
    '## 2026-07-15 — KI', '- **What:** d', '- **Why:** workaround x', '- **QA-Release-Note:** known-issue', '',
    '## 2026-07-15 — Api', '- **What:** e', '- **QA-Release-Note:** api', '',
    '## 2026-07-15 — Cfg', '- **What:** f', '- **QA-Release-Note:** config',
  ].join('\n');
  const tmp = path.join(os.tmpdir(), `rn-agg-${process.pid}.md`);
  fs.writeFileSync(tmp, md);
  const a = aggregate({ sinceIso: '2026-07-01T00:00:00Z', files: [{ path: tmp, module: 'm' }] });
  assert.strictEqual(a.features.length, 1);
  assert.strictEqual(a.enhancements.length, 1);
  assert.strictEqual(a.whatToTest.length, 1);
  assert.strictEqual(a.knownIssues.length, 1);
  assert.strictEqual(a.knownIssues[0][2], 'workaround x');   // Why → workaround column
  assert.strictEqual(a.apiChanges.length, 1);
  assert.strictEqual(a.configChanges.length, 1);
});

test('content.parseTable reads markdown-table rows as triples', () => {
  const md = '| Issue ID | Description | Workaround |\n|---|---|---|\n| 364 | bad url | validate |\n| | scheduler | feature-wise |\n';
  const rows = parseTable(md);
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows[0], ['364', 'bad url', 'validate']);
  assert.deepStrictEqual(rows[1], ['', 'scheduler', 'feature-wise']);
});

test('render: Config/API sections show data rows or fall back to None', () => {
  const withData = render({ version: 19, releaseDate: 'x', bugs: [],
    apiChanges: [['/v1/foo', 'Added', 'new endpoint']], configChanges: [['FEATURE_X', 'enable flag', 'restart']] });
  assert.ok(withData.includes('/v1/foo') && withData.includes('FEATURE_X'));
  const none = render({ version: 19, releaseDate: 'x', bugs: [] });
  assert.ok(none.includes('No API changes are included in this release.'));
  assert.ok(none.includes('No configuration changes are required for this release.'));
});
