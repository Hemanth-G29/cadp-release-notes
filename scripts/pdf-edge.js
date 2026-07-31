'use strict';

/**
 * Convert the freshly built final HTML into a mail-ready PDF using headless Edge/Chrome
 * (no npm install needed on Windows/most machines). Names it to match the QA mail convention:
 *   out/Release Notes V1.0.0 (<N>).pdf
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { release } = require('../src/config');

const version = release.liveVersion;
const outDir = path.join(__dirname, '..', 'out');
const htmlPath = path.join(outDir, `Release_Notes_V1.0.0_BUILD${version}.html`);
const pdfPath = path.join(outDir, `Release Notes V1.0.0 (${version}).pdf`);
const tmpPdf = path.join(outDir, `.build-${version}-${process.pid}.pdf`);

const sleep = ms => new Promise(r => setTimeout(r, ms));

function findBrowser() {
  const candidates = [
    process.env.BROWSER_PATH,
    `${process.env['ProgramFiles']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env['ProgramFiles']}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge',
  ].filter(Boolean);
  return candidates.find(p => { try { return fs.existsSync(p); } catch { return false; } });
}

async function main() {
  if (!fs.existsSync(htmlPath)) {
    console.error(`HTML not found: ${htmlPath}\nRun: node scripts/build-live.js --final`);
    process.exit(1);
  }
  const browser = findBrowser();
  if (!browser) {
    console.error('No Edge/Chrome found. Set BROWSER_PATH, or open the HTML and Print → Save as PDF.');
    process.exit(1);
  }

  try { fs.rmSync(tmpPdf, { force: true }); } catch { /* ignore */ }
  const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');
  // Fresh --user-data-dir forces a new instance so it doesn't delegate to a running Edge and return early.
  const userDataDir = path.join(os.tmpdir(), `rn-edge-${process.pid}`);
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`, '--no-pdf-header-footer',
    `--print-to-pdf=${tmpPdf}`, fileUrl,
  ];

  const child = spawn(browser, args, { stdio: 'ignore' });
  await new Promise(res => child.on('exit', res));

  // Poll up to ~20s for the file to be flushed.
  for (let i = 0; i < 40 && !(fs.existsSync(tmpPdf) && fs.statSync(tmpPdf).size > 0); i++) await sleep(500);

  if (fs.existsSync(tmpPdf) && fs.statSync(tmpPdf).size > 0) {
    fs.rmSync(pdfPath, { force: true });
    fs.renameSync(tmpPdf, pdfPath);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
    console.log(`PDF ready to attach: ${pdfPath} (${(fs.statSync(pdfPath).size / 1024).toFixed(0)} KB)`);
  } else {
    console.error('PDF was not created; open the HTML in a browser and Print → Save as PDF instead.');
    process.exit(1);
  }
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
