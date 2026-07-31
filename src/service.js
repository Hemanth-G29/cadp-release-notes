'use strict';

const { reconcileDevelopedBugs } = require('./reconcile');
const { render } = require('./render');
const { fetchAccountTimeZone } = require('./openproject');
const { aggregate } = require('./changelog');
const { readContent } = require('./content');
const { narrative: narrativeCfg } = require('./config');

/** Format "Month D, YYYY" in the given IANA timezone. */
function displayDate(tz) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz || 'Asia/Kolkata', year: 'numeric', month: 'long', day: 'numeric',
  }).format(new Date());
}

/**
 * Reconcile the live bug set and (re)render + persist the live (draft) doc.
 * This is what a Cloud Scheduler tick calls. Returns a small summary.
 */
async function tickReconcile(store) {
  const state = await store.readState();
  const tz = await fetchAccountTimeZone().catch(() => 'Asia/Kolkata');
  const { bugs, totalDeveloped, cutoffIso } = await reconcileDevelopedBugs({ cutoffIso: state.lastCutAt || '' });

  const narrative = buildNarrative(state);

  const html = render({
    version: state.liveVersion,
    releaseDate: displayDate(tz),
    bugs,
    features: narrative.features,
    enhancements: narrative.enhancements,
    whatToTest: narrative.whatToTest,
    knownIssues: narrative.knownIssues,
    apiChanges: narrative.apiChanges,
    configChanges: narrative.configChanges,
    draft: true,
  });

  await store.writeBuild(state.liveVersion, html);
  await store.writeState({ ...state, bugs, narrative: narrative.persisted });

  return {
    liveVersion: state.liveVersion, bugCount: bugs.length, totalDeveloped, cutoffIso, tz,
    narrativeCounts: narrative.counts,
  };
}

/**
 * Merge narrative from all sources with clear precedence:
 *   approved state.narrative  >  docs/changes tags (CHANGELOG_ROOT)  >  manifests (CONTENT_DIR)  >  baseline
 * Feature/enhancement/what-to-test come from tags; known-issue/api/config combine manifests + tags.
 * Returns render-ready fields plus `persisted` (what to write back to state) and `counts`.
 */
function buildNarrative(state) {
  const approved = state.narrative || {};
  let agg = null;
  if (narrativeCfg.changelogRoot) {
    try { agg = aggregate({ root: narrativeCfg.changelogRoot, sinceIso: state.lastCutAt || '' }); }
    catch (e) { console.warn('[narrative] changelog aggregate failed:', e.message); }
  }
  const content = readContent(narrativeCfg.contentDir);

  const pick = (approvedVal, ...fallbacks) => {
    if (approvedVal && approvedVal.length) return approvedVal;
    for (const f of fallbacks) if (f && f.length) return f;
    return [];
  };

  const features = pick(approved.features, [...content.features, ...(agg?.features || [])]);
  const enhancements = pick(approved.enhancements, [...content.enhancements, ...(agg?.enhancements || [])]);
  const whatToTest = pick(approved.whatToTest, agg?.whatToTest);
  // Table sections: manifest first (human-curated), then tagged entries. Empty => render falls back.
  const knownIssues = [...content.knownIssues, ...(agg?.knownIssues || [])];
  const apiChanges = [...content.apiChanges, ...(agg?.apiChanges || [])];
  const configChanges = [...content.configChanges, ...(agg?.configChanges || [])];

  return {
    features, enhancements, whatToTest, knownIssues, apiChanges, configChanges,
    persisted: { features, enhancements, whatToTest, knownIssues, apiChanges, configChanges },
    counts: agg ? { ...agg.counts, knownIssues: knownIssues.length, api: apiChanges.length, config: configChanges.length }
                : { scanned: 0, tagged: 0, knownIssues: knownIssues.length, api: apiChanges.length, config: configChanges.length },
  };
}

/** Return the HTML for a specific version (frozen from store, or the live draft). */
async function getVersionHtml(store, version) {
  return store.readBuild(version);
}

/** The highest known version (the live one). */
async function latestVersion(store) {
  const state = await store.readState();
  const versions = await store.listVersions();
  return Math.max(state.liveVersion, ...(versions.length ? versions : [state.liveVersion]));
}

module.exports = { tickReconcile, getVersionHtml, latestVersion, displayDate };
