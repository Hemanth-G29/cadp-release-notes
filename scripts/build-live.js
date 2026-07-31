'use strict';

/**
 * Generate the current LIVE release-notes doc from live OpenProject data and write it to ./out.
 * Local stand-in for a Cloud Run / Actions tick.
 *
 *   node scripts/build-live.js            → DRAFT (yellow banner) — internal preview
 *   node scripts/build-live.js --final    → final (no banner) — the copy you attach to the QA mail
 *
 * Also writes a PDF if `puppeteer` is installed; otherwise prints how to Print-to-PDF from a browser.
 */

const fs = require('node:fs');
const path = require('node:path');
const { reconcileDevelopedBugs } = require('../src/reconcile');
const { render } = require('../src/render');
const { fetchAccountTimeZone } = require('../src/openproject');
const { release, narrative: narrativeCfg } = require('../src/config');
const { aggregate } = require('../src/changelog');
const { readContent } = require('../src/content');

const FINAL = process.argv.includes('--final') || process.env.FINAL === '1';

function pick(...arrs) { for (const a of arrs) if (a && a.length) return a; return []; }

async function main() {
  const tz = await fetchAccountTimeZone();
  const { bugs, totalDeveloped, cutoffIso } = await reconcileDevelopedBugs({ cutoffIso: release.cutoffIso });
  const version = release.liveVersion;

  const releaseDate = new Intl.DateTimeFormat('en-US', {
    timeZone: tz || 'Asia/Kolkata', year: 'numeric', month: 'long', day: 'numeric',
  }).format(new Date());

  // Narrative from docs/changes tags (if CHANGELOG_ROOT set) + optional manifests.
  let agg = null;
  if (narrativeCfg.changelogRoot) {
    try { agg = aggregate({ root: narrativeCfg.changelogRoot, sinceIso: release.cutoffIso || '' }); } catch { /* ignore */ }
  }
  const content = readContent(narrativeCfg.contentDir);

  const html = render({
    version, releaseDate, bugs, draft: !FINAL,
    features: [...content.features, ...(agg?.features || [])],
    enhancements: [...content.enhancements, ...(agg?.enhancements || [])],
    whatToTest: agg?.whatToTest,
    knownIssues: [...content.knownIssues, ...(agg?.knownIssues || [])],
    apiChanges: [...content.apiChanges, ...(agg?.apiChanges || [])],
    configChanges: [...content.configChanges, ...(agg?.configChanges || [])],
  });

  const outDir = path.join(__dirname, '..', 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const base = `Release_Notes_V1.0.0_BUILD${version}`;
  const htmlPath = path.join(outDir, `${base}.html`);
  fs.writeFileSync(htmlPath, html);

  console.log(`Mode         : ${FINAL ? 'FINAL (no draft banner — ready to attach)' : 'DRAFT (preview)'}`);
  console.log(`Timezone     : ${tz}   Release date: ${releaseDate}`);
  console.log(`Bugs in doc  : ${bugs.length} / ${totalDeveloped} Developed   (cutoff: ${cutoffIso || 'none'})`);
  console.log(`HTML         : ${htmlPath}`);

  // PDF if puppeteer is available.
  try {
    const { htmlToPdf } = require('../src/pdf');
    const pdf = await htmlToPdf(html);
    const pdfPath = path.join(outDir, `${base}.pdf`);
    fs.writeFileSync(pdfPath, pdf);
    console.log(`PDF          : ${pdfPath}`);
  } catch (e) {
    console.log(`PDF          : not generated (${e.code === 'PDF_UNAVAILABLE' ? 'puppeteer not installed' : e.message})`);
    console.log(`               → open the HTML in a browser, Ctrl+P → "Save as PDF", save as "Release Notes V1.0.0 (${version}).pdf".`);
    console.log(`               → or run once: npm install puppeteer  (then re-run this to auto-create the PDF).`);
  }
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
