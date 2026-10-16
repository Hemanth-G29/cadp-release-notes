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

const { describeBuild, renderHistoryPage } = require('../src/history');

test('describeBuild: release date from the overview row, Draft only when the page has the banner', () => {
  const live = render({ version: 23, releaseDate: 'October 16, 2026', bugs: [], draft: true });
  const frozen = render({ version: 22, releaseDate: 'October 16, 2026', bugs: [], draft: false });
  assert.deepStrictEqual(describeBuild(23, live, 23), { version: 23, releaseDate: 'October 16, 2026', status: 'Draft', current: true });
  assert.deepStrictEqual(describeBuild(22, frozen, 23), { version: 22, releaseDate: 'October 16, 2026', status: 'Published', current: false });
  assert.deepStrictEqual(describeBuild(5, '', 23), { version: 5, releaseDate: '', status: 'Published', current: false });
});

test('renderHistoryPage: newest first, data embedded safely, empty list still renders', () => {
  const page = renderHistoryPage([
    { version: 19, releaseDate: 'a', status: 'Published', current: false },
    { version: 23, releaseDate: '</script><b>', status: 'Draft', current: true },
    { version: 22, releaseDate: 'c', status: 'Published', current: false },
  ]);
  const data = JSON.parse(/window\.BUILDS=(.*?);<\/script>/.exec(page)[1]);
  assert.deepStrictEqual(data.map(b => b.version), [23, 22, 19]);
  assert.strictEqual(data[0].releaseDate, '</script><b>');
  assert.ok(!page.includes('</script><b>'), 'a release date must not be able to close the script tag');
  assert.ok(page.includes('./release-notes-v') && page.includes('index.pdf'));
  const empty = renderHistoryPage([]);
  assert.ok(empty.includes('window.BUILDS=[]') && empty.includes('No release notes published yet'));
});

test('pages store: site root becomes the history page listing every stored build', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-site-'));
  const prev = { b: process.env.STORE_BACKEND, s: process.env.SITE_DIR };
  try {
    process.env.STORE_BACKEND = 'pages'; process.env.SITE_DIR = dir;
    delete require.cache[require.resolve('../src/config')]; delete require.cache[require.resolve('../src/store')];
    const store = require('../src/store').createStore();
    await store.writeBuild(21, render({ version: 21, releaseDate: 'Oct 13, 2026', bugs: [], draft: false }));
    await store.writeBuild(22, render({ version: 22, releaseDate: 'Oct 16, 2026', bugs: [], draft: true }));
    await store.writeLatestIndex(22);
    const page = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    const data = JSON.parse(/window\.BUILDS=(.*?);<\/script>/.exec(page)[1]);
    assert.deepStrictEqual(data.map(b => [b.version, b.status, b.current]), [[22, 'Draft', true], [21, 'Published', false]]);
    assert.ok(fs.existsSync(path.join(dir, '.nojekyll')));
  } finally {
    process.env.STORE_BACKEND = prev.b; process.env.SITE_DIR = prev.s;
    if (prev.b === undefined) delete process.env.STORE_BACKEND;
    if (prev.s === undefined) delete process.env.SITE_DIR;
    delete require.cache[require.resolve('../src/config')]; delete require.cache[require.resolve('../src/store')];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('renderPdfOnlyPage: a PDF-only build is listed with its date and Published', () => {
  const { renderPdfOnlyPage } = require('../src/history');
  const page = renderPdfOnlyPage({ version: 6, releaseDate: 'March 25, 2026' });
  assert.ok(page.includes("getDocument('./index.pdf')") && page.includes('pdfjs-dist@4.10.38'));
  assert.ok(page.includes('./index.pdf#toolbar=0&navpanes=0'), 'fallback viewer hides its toolbar');
  assert.ok(page.includes('<table hidden>') && !page.includes('<h1>'), 'no visible duplicate header');
  assert.deepStrictEqual(describeBuild(6, page, 23), { version: 6, releaseDate: 'March 25, 2026', status: 'Published', current: false });
  assert.ok(renderPdfOnlyPage({ version: 7, releaseDate: '<x>' }).includes('&lt;x&gt;'));
});

test('renderPdfOnlyPage: extra PDFs of the same build are linked', () => {
  const { renderPdfOnlyPage } = require('../src/history');
  const page = renderPdfOnlyPage({ version: 12, releaseDate: 'May 19, 2026', extras: [{ file: 'also.pdf', label: 'Web-only version (May 18, 2026)' }] });
  assert.ok(page.includes('href="./also.pdf"') && page.includes('Web-only version (May 18, 2026)'));
  assert.ok(!renderPdfOnlyPage({ version: 13, releaseDate: 'x' }).includes('Also issued'));
});
