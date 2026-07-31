'use strict';

/**
 * Cron entrypoint for the GitHub Actions + GitHub Pages model.
 *
 * Each run (every ~10-15 min, or on manual dispatch):
 *   1. Reconcile the live bug set from OpenProject and (re)render the live draft doc.
 *   2. Check the "CADP - QA Release" Outlook thread; if a newer version was announced,
 *      roll over (freeze vN, move its bugs Developed→Ready-for-Testing, reply in thread, open v(N+1)).
 *   3. Write the site root redirect → latest.
 *
 * Runs to completion and exits; the workflow then commits `site/` and deploys it to Pages.
 * No long-running server — GitHub Actions is the scheduler, GitHub Pages is the host.
 */

const { createStore } = require('../src/store');
const svc = require('../src/service');
const mailwatch = require('../src/mailwatch');
const { htmlToPdf } = require('../src/pdf');

/**
 * Generate PDFs alongside each version: always refresh the live version (its content changes),
 * and backfill any frozen version missing a PDF. The live PDF is also copied to /latest.pdf for a
 * stable download link. No-ops cleanly if puppeteer/Chromium isn't available (e.g. local dev).
 */
async function ensurePdfs(store, liveVersion) {
  if (!store.writePdf) return { skipped: 'store has no pdf support' };
  const versions = await store.listVersions();
  const generated = [];
  for (const v of versions) {
    const needed = v === liveVersion || !(await store.pdfExists(v));
    if (!needed) continue;
    const html = await store.readBuild(v);
    if (!html) continue;
    try {
      const pdf = await htmlToPdf(html);
      await store.writePdf(v, pdf);
      if (v === liveVersion && store.writeLatestPdf) await store.writeLatestPdf(pdf);
      generated.push(v);
    } catch (e) {
      if (e.code === 'PDF_UNAVAILABLE') return { skipped: 'puppeteer unavailable' };
      console.warn(`pdf gen failed v${v}:`, e.message);
    }
  }
  return { generated };
}

async function main() {
  const store = createStore();

  const reconcile = await svc.tickReconcile(store);
  console.log(`reconcile: liveVersion=${reconcile.liveVersion} bugs=${reconcile.bugCount} tz=${reconcile.tz}` +
    (reconcile.narrativeCounts ? ` narrative(tagged=${reconcile.narrativeCounts.tagged})` : ''));

  let rollover = { skipped: 'graph not configured' };
  try {
    rollover = await mailwatch.checkAndRollover({ store });
  } catch (e) {
    rollover = { error: e.message };
  }
  console.log('mail-watch:', JSON.stringify(rollover));

  const latest = await svc.latestVersion(store);
  if (store.writeLatestIndex) await store.writeLatestIndex(latest);
  console.log(`latest version: ${latest} (site root redirects here)`);

  const pdf = await ensurePdfs(store, latest);
  console.log('pdf:', JSON.stringify(pdf));
}

main().catch(e => { console.error('tick failed:', e.message); process.exit(1); });
