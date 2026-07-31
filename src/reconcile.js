'use strict';

const { fetchDevelopedBugs, fetchLastStatusChangeTo } = require('./openproject');
const { release } = require('./config');

/**
 * Build the live bug set for the current release.
 *
 * Without a cutoff → all bugs currently in Developed (correct right after a rollover, since the
 * previous build's bugs were already moved out of Developed).
 * With a cutoff → only bugs whose status moved to Developed AFTER the cutoff (the release-mail
 * send-time). Comparison is in UTC.
 *
 * Returns { bugs: [{id, subject}], totalDeveloped, cutoffIso }.
 */
async function reconcileDevelopedBugs({ cutoffIso } = {}) {
  const rows = await fetchDevelopedBugs();
  const cutoff = (cutoffIso ?? release.cutoffIso) || '';

  let selected = rows;
  if (cutoff) {
    const cutoffMs = Date.parse(cutoff);
    const movedAt = await Promise.all(rows.map(r => fetchLastStatusChangeTo(r.id, 'Developed')));
    selected = rows.filter((_, i) => movedAt[i] && Date.parse(movedAt[i]) > cutoffMs);
  }

  const bugs = selected
    .map(r => ({ id: r.id, subject: r.subject }))
    .sort((a, b) => a.id - b.id);

  return { bugs, totalDeveloped: rows.length, cutoffIso: cutoff || null };
}

module.exports = { reconcileDevelopedBugs };
