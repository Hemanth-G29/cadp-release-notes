'use strict';

const { fetchDevelopedBugs, moveStatus } = require('./openproject');
const { render } = require('./render');
const { ids } = require('./config');

/** Move a set of bug IDs Developed -> Ready for Testing, idempotently and lockVersion-safe. */
async function moveDevelopedToRft(bugIds, { dryRun = false, concurrency = 5 } = {}) {
  const developed = await fetchDevelopedBugs();
  const lockById = new Map(developed.map(b => [b.id, b.lockVersion]));

  const toMove = bugIds.filter(id => lockById.has(id));
  const skipped = bugIds.filter(id => !lockById.has(id)); // already moved on / not Developed

  const updated = [];
  const failed = [];

  if (!dryRun) {
    let i = 0;
    async function worker() {
      while (i < toMove.length) {
        const id = toMove[i++];
        const res = await moveStatus(id, lockById.get(id), ids.STATUS_READY_FOR_TESTING);
        if (res.result === 'updated') updated.push(id);
        else failed.push({ id, reason: res.reason, httpStatus: res.httpStatus });
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, toMove.length) }, worker));
  }

  return {
    moved: dryRun ? toMove : updated,
    wouldMove: toMove,
    skipped,
    failed,
    dryRun,
  };
}

/**
 * Perform a version rollover triggered by the release mail for `announcedVersion` (= N).
 * Freezes vN's doc, moves vN's bugs to Ready for Testing, advances the live doc to v(N+1).
 *
 * deps: { store, releaseDate, cutoffIso, mailId, tz }
 * opts: { dryRun }
 * Returns an audit object (also used to build the in-thread confirmation email).
 */
async function performRollover({ store, releaseDate, cutoffIso, mailId, tz }, { dryRun = false } = {}) {
  const state = await store.readState();
  const N = state.liveVersion; // the doc we've been building is BUILD N; the mail announces N

  // vN's bug set = whatever is currently Developed (not yet moved).
  const developed = await fetchDevelopedBugs();
  const bugs = developed
    .map(b => ({ id: b.id, subject: b.subject }))
    .sort((a, b) => a.id - b.id);

  // 1. Freeze vN's final (non-draft) doc.
  const n = state.narrative || {};
  const frozenHtml = render({
    version: N,
    releaseDate: releaseDate || state.overview?.releaseDate || '',
    bugs,
    features: n.features,
    enhancements: n.enhancements,
    whatToTest: n.whatToTest,
    knownIssues: n.knownIssues,
    apiChanges: n.apiChanges,
    configChanges: n.configChanges,
    draft: false,
  });
  if (!dryRun) await store.writeBuild(N, frozenHtml);

  // 2. Move vN's bugs Developed -> Ready for Testing.
  const move = await moveDevelopedToRft(bugs.map(b => b.id), { dryRun });

  // 3. Advance state to v(N+1).
  const next = N + 1;
  const newState = {
    ...state,
    liveVersion: next,
    latestAnnouncedVersion: N,
    lastProcessedMailId: mailId ?? state.lastProcessedMailId,
    lastCutAt: cutoffIso || state.lastCutAt,
    bugs: [],
    narrative: { features: [], enhancements: [], knownIssues: [], whatToTest: [] },
    approvedAt: null,
  };
  if (!dryRun) await store.writeState(newState);

  return {
    version: N,
    nextVersion: next,
    cutoffIso: cutoffIso || state.lastCutAt,
    frozenBugCount: bugs.length,
    moved: move.moved,
    skipped: move.skipped,
    failed: move.failed,
    dryRun,
  };
}

/** Human-readable summary for the in-thread confirmation reply. */
function summaryText(audit, baseUrl) {
  const link = v => `${baseUrl || ''}/release-notes-v${v}/`;
  const lines = [];
  lines.push(`Release notes rollover: BUILD ${audit.version} → live BUILD ${audit.nextVersion}${audit.dryRun ? ' (DRY RUN)' : ''}.`);
  lines.push(`Cutoff: ${audit.cutoffIso || '(none)'}`);
  lines.push(`Bugs moved Developed → Ready for Testing: ${audit.moved.length}`);
  if (audit.moved.length) lines.push(`  IDs: ${audit.moved.join(', ')}`);
  if (audit.skipped.length) lines.push(`Skipped (not currently Developed / already moved): ${audit.skipped.length} — ${audit.skipped.join(', ')}`);
  if (audit.failed.length) lines.push(`FAILED: ${audit.failed.map(f => `${f.id} (${f.reason})`).join('; ')}`);
  lines.push(`Frozen: ${link(audit.version)}`);
  lines.push(`Now live: ${link(audit.nextVersion)}`);
  return lines.join('\n');
}

module.exports = { performRollover, moveDevelopedToRft, summaryText };
