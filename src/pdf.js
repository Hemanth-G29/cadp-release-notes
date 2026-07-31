'use strict';

/**
 * HTML -> PDF. Optional: uses `puppeteer` if it's installed (bundled in the Cloud Run image).
 * If puppeteer isn't available, callers get a clear 501 rather than a crash.
 *
 * The Cloud Run Dockerfile installs puppeteer + a headless Chromium; locally (zero-dep) this
 * simply reports unavailable.
 */
async function htmlToPdf(html) {
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch {
    const err = new Error('PDF unavailable: puppeteer not installed in this environment');
    err.code = 'PDF_UNAVAILABLE';
    throw err;
  }
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    headless: 'new',
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    return await page.pdf({ format: 'A4', printBackground: true });
  } finally {
    await browser.close();
  }
}

module.exports = { htmlToPdf };
