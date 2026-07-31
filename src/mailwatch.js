'use strict';

const https = require('node:https');
const { graph } = require('./config');
const { performRollover, summaryText } = require('./rollover');
const { fetchAccountTimeZone } = require('./openproject');
const { displayDate } = require('./service');

/**
 * Microsoft Graph watcher for the "CADP - QA Release" thread.
 *
 * On each tick: find the latest release mail, parse the announced version N from the body,
 * and if N is newer than what we've processed, perform the rollover (freeze vN, move its bugs
 * to Ready for Testing, open v(N+1)) and reply in-thread with the summary.
 *
 * No-ops cleanly if Graph credentials aren't configured, so the rest of the service still runs.
 */

function isConfigured() {
  return Boolean(graph.tenantId && graph.clientId && graph.clientSecret && graph.mailbox);
}

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getToken() {
  const form = new URLSearchParams({
    client_id: graph.clientId,
    client_secret: graph.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  }).toString();
  const { status, body } = await httpsRequest({
    hostname: 'login.microsoftonline.com',
    path: `/${graph.tenantId}/oauth2/v2.0/token`,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(form) },
  }, form);
  if (status !== 200) throw new Error(`Graph token failed: HTTP ${status} ${body.slice(0, 200)}`);
  return JSON.parse(body).access_token;
}

async function graphGet(token, path) {
  const { status, body } = await httpsRequest({
    hostname: 'graph.microsoft.com',
    path,
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (status < 200 || status >= 300) throw new Error(`Graph GET ${path}: HTTP ${status} ${body.slice(0, 200)}`);
  return JSON.parse(body);
}

/** Latest message in the release thread (by subject), newest first. */
async function latestReleaseMail(token) {
  const subj = graph.releaseMailSubject.replace(/'/g, "''");
  const qs =
    `$filter=${encodeURIComponent(`subject eq '${subj}'`)}` +
    `&$orderby=${encodeURIComponent('sentDateTime desc')}` +
    `&$top=1` +
    `&$select=${encodeURIComponent('id,subject,sentDateTime,conversationId,from,body,bodyPreview')}`;
  const path = `/v1.0/users/${encodeURIComponent(graph.mailbox)}/messages?${qs}`;
  const data = await graphGet(token, path);
  return (data.value || [])[0] || null;
}

async function replyInThread(token, messageId, comment) {
  const payload = JSON.stringify({ comment });
  const { status, body } = await httpsRequest({
    hostname: 'graph.microsoft.com',
    path: `/v1.0/users/${encodeURIComponent(graph.mailbox)}/messages/${messageId}/reply`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  }, payload);
  if (status < 200 || status >= 300) throw new Error(`Graph reply: HTTP ${status} ${body.slice(0, 200)}`);
}

function parseVersion(text) {
  const m = graph.versionRegex.exec(text || '');
  return m ? Number(m[1]) : null;
}

/**
 * Check the thread and roll over if a newer version was announced.
 * Returns a status object (never throws for "nothing to do").
 */
async function checkAndRollover({ store, dryRun = false } = {}) {
  if (!isConfigured()) return { skipped: 'graph not configured' };

  const token = await getToken();
  const mail = await latestReleaseMail(token);
  if (!mail) return { skipped: 'no release mail found', subject: graph.releaseMailSubject };

  const bodyText = (mail.body && mail.body.content) || mail.bodyPreview || '';
  const version = parseVersion(bodyText) ?? parseVersion(mail.subject);
  if (version == null) {
    return { alert: 'could not parse version from release mail', subject: mail.subject, mailId: mail.id };
  }

  const state = await store.readState();
  if (mail.id === state.lastProcessedMailId || version <= state.latestAnnouncedVersion) {
    return { skipped: 'already processed', announcedVersion: version, latestAnnouncedVersion: state.latestAnnouncedVersion };
  }

  const tz = await fetchAccountTimeZone().catch(() => 'Asia/Kolkata');
  const audit = await performRollover(
    { store, releaseDate: displayDate(tz), cutoffIso: mail.sentDateTime, mailId: mail.id, tz },
    { dryRun }
  );

  const base = process.env.PUBLIC_BASE_URL || '';
  const text = summaryText(audit, base);
  if (!dryRun) {
    await replyInThread(token, mail.id, text.replace(/\n/g, '<br>'));
  }
  return { ...audit, announcedVersion: version, repliedInThread: !dryRun, summary: text };
}

module.exports = { checkAndRollover, parseVersion, isConfigured };
