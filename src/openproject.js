'use strict';

const https = require('node:https');
const { openproject, ids } = require('./config');

/**
 * OpenProject API v3 client.
 *
 * Notes baked in from hard-won experience with this instance:
 *  - Auth is HTTP Basic with username "apikey" and the token as the password.
 *  - `offset` in the work_packages API is a 1-BASED PAGE NUMBER, not a record offset.
 *    Increment it by 1 per page. (The old scripts did `offset += pageSize`, which silently
 *    dropped every result past the first page — 100 of 149 Developed bugs went missing.)
 *  - All timestamps returned by the API are UTC (ISO-8601 with trailing `Z`). Compare in UTC.
 */

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`apikey:${openproject.token}`).toString('base64');
    const payload = body ? JSON.stringify(body) : null;
    const headers = { Authorization: `Basic ${auth}`, Accept: 'application/json' };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = https.request(
      { hostname: openproject.host, path, method, headers },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          let json = null;
          try { json = data ? JSON.parse(data) : null; } catch { /* leave null */ }
          resolve({ status: res.statusCode, json, raw: data });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function apiGet(path) {
  const { status, json, raw } = await request('GET', path);
  if (status < 200 || status >= 300 || !json) {
    throw new Error(`GET ${path} failed (HTTP ${status}): ${String(raw).slice(0, 200)}`);
  }
  return json;
}

function encodeFilters(filters) {
  return encodeURIComponent(JSON.stringify(filters));
}

/** Map a raw work package to a compact row. */
function toRow(wp) {
  const links = wp._links || {};
  return {
    id: wp.id,
    subject: wp.subject || '',
    lockVersion: wp.lockVersion,
    status: links.status?.title || '',
    priority: links.priority?.title || '',
    assignee: links.assignee?.title || 'Unassigned',
    createdAt: wp.createdAt,
    updatedAt: wp.updatedAt,
  };
}

/**
 * Fetch every work package matching `filters`, paginating correctly.
 * `filters` is the OpenProject filter array, e.g. [{ status: { operator: '=', values: ['8'] } }].
 */
async function fetchWorkPackages(filters, pageSize = 100) {
  const encoded = encodeFilters(filters);
  let page = 1; // 1-based PAGE NUMBER
  const all = [];
  for (;;) {
    const url = `/api/v3/projects/${openproject.projectId}/work_packages` +
      `?filters=${encoded}&pageSize=${pageSize}&offset=${page}`;
    const resp = await apiGet(url);
    const items = resp._embedded?.elements || [];
    all.push(...items);
    const total = resp.total || 0;
    if (all.length >= total || items.length === 0) break;
    page += 1;
  }
  return all;
}

/** All bugs currently in a given status, as compact rows. */
async function fetchBugsByStatus(statusId, pageSize = 100) {
  const filters = [
    { type: { operator: '=', values: [String(ids.TYPE_BUG)] } },
    { status: { operator: '=', values: [String(statusId)] } },
  ];
  const rows = (await fetchWorkPackages(filters, pageSize)).map(toRow);
  return rows;
}

/** Convenience: all bugs currently in Developed. */
function fetchDevelopedBugs() {
  return fetchBugsByStatus(ids.STATUS_DEVELOPED);
}

/**
 * The last time a work package's status changed TO `statusLabel` (returns an ISO UTC string
 * or null). Uses the activity/journal endpoint; matches details like "status changed ... to developed".
 */
async function fetchLastStatusChangeTo(wpId, statusLabel) {
  const resp = await apiGet(`/api/v3/work_packages/${wpId}/activities`);
  const activities = resp._embedded?.elements || [];
  const target = `to ${statusLabel.toLowerCase()}`;
  let lastDate = null;
  for (const act of activities) {
    const matched = (act.details || []).some(d =>
      typeof d.raw === 'string' &&
      d.raw.toLowerCase().startsWith('status changed') &&
      d.raw.toLowerCase().endsWith(target)
    );
    if (matched) lastDate = act.createdAt;
  }
  return lastDate;
}

/** Read the account's configured IANA timezone (e.g. "Asia/Kolkata"). Display only. */
async function fetchAccountTimeZone() {
  // /api/v3/my_preferences 301-redirects to /api/v3/users/me/preferences.
  const prefs = await apiGet('/api/v3/users/me/preferences');
  return prefs.timeZone || 'UTC';
}

/**
 * Move a work package to `statusId`, using its current lockVersion (optimistic locking).
 * Returns { id, result: 'updated', newStatus } or { id, result: 'failed', httpStatus, reason }.
 */
async function moveStatus(id, lockVersion, statusId) {
  const body = { lockVersion, _links: { status: { href: `/api/v3/statuses/${statusId}` } } };
  const { status, json, raw } = await request('PATCH', `/api/v3/work_packages/${id}`, body);
  if (status >= 200 && status < 300) {
    return { id, result: 'updated', newStatus: json?._links?.status?.title || String(statusId) };
  }
  const reason =
    json?.message ||
    json?._embedded?.errors?.map(e => e.message).join('; ') ||
    String(raw).slice(0, 200) ||
    `HTTP ${status}`;
  return { id, result: 'failed', httpStatus: status, reason };
}

module.exports = {
  request,
  apiGet,
  fetchWorkPackages,
  fetchBugsByStatus,
  fetchDevelopedBugs,
  fetchLastStatusChangeTo,
  fetchAccountTimeZone,
  moveStatus,
  toRow,
};
