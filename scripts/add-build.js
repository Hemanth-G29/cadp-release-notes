'use strict';

/**
 * Add an old, already-sent build to the published site so it shows on the Release History page.
 *
 *   node scripts/add-build.js --version 14 --html "<path>.html" [--pdf "<path>.pdf"]
 *   node scripts/add-build.js --version 18 --pdf "<path>.pdf" --date "July 15, 2026"
 *
 * With only a PDF, a small page that shows the PDF inline is generated (--date required).
 * With only a page, the next workflow run renders its PDF (ensurePdfs backfills missing PDFs).
 * Refuses to overwrite an existing build or touch the live one unless --force.
 */

process.env.STORE_BACKEND = 'pages';
process.env.SITE_DIR = process.env.SITE_DIR || 'site';

const fs = require('node:fs');
const { createStore } = require('../src/store');
const { renderPdfOnlyPage } = require('../src/history');

function parseArgs(argv) {
  const out = { force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') out.force = true;
    else if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
  }
  out.version = Number(out.version);
  return out;
}

function validate(args, state, exists) {
  if (!Number.isInteger(args.version) || args.version < 1) return '--version must be a positive whole number';
  if (!args.html && !args.pdf) return 'give --html, --pdf, or both';
  if (args.html && !fs.existsSync(args.html)) return `--html not found: ${args.html}`;
  if (args.pdf && !fs.existsSync(args.pdf)) return `--pdf not found: ${args.pdf}`;
  if (!args.html && !args.date) return '--date is required when there is no --html page';
  if (args.version >= state.liveVersion && !args.force) return `v${args.version} is not older than the live v${state.liveVersion}`;
  if (exists && !args.force) return `v${args.version} is already on the site (use --force to replace it)`;
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const store = createStore();
  const state = await store.readState();
  const error = validate(args, state, Boolean(await store.readBuild(args.version)));
  if (error) { console.error(`add-build: ${error}`); process.exit(1); }

  const html = args.html
    ? fs.readFileSync(args.html, 'utf8')
    : renderPdfOnlyPage({ version: args.version, releaseDate: args.date });
  await store.writeBuild(args.version, html);
  if (args.pdf) await store.writePdf(args.version, fs.readFileSync(args.pdf));
  await store.writeLatestIndex(state.liveVersion);
  console.log(`added v${args.version}: page ${args.html ? 'copied' : 'generated (PDF view)'}` +
    `, PDF ${args.pdf ? 'copied' : 'rendered by the next workflow run'}`);
}

main().catch(e => { console.error('add-build failed:', e.message); process.exit(1); });
