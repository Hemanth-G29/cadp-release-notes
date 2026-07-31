'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Default/baseline content for the narrative sections.
 *
 * The full "What to Test" (§9) and "What to Test on Mobile" (§10) tester checklists live in
 * templates/what-to-test.html and templates/what-to-test-mobile.html (carried from the last
 * release). Per-release `test`-tagged docs/changes items are appended after this baseline.
 *
 * New Features / Enhancements default to a single "None" row for a fresh live doc.
 */

function readTemplate(name, fallback) {
  try { return fs.readFileSync(path.join(__dirname, '..', 'templates', name), 'utf8').trim(); }
  catch { return fallback; }
}

const NONE_FEATURE_ROW =
  '    <tr><td></td><td>None</td><td>No new features recorded yet for this release.</td><td>N/A</td></tr>';

const NONE_ENHANCEMENT_ROW =
  '    <tr><td></td><td>None</td><td>No enhancements recorded yet for this release.</td><td>N/A</td></tr>';

// Known Issues baseline (carried forward). Each row: [issueId, description, workaround].
const DEFAULT_KNOWN_ISSUES = [
  ['', 'Role Management Change Effect',
    'Because some menu structures have changed, certain features may return a 403 status code. To resolve this, edit the role, select the platform feature, and save the role again.'],
  ['', 'Scheduler with Workflow Not Working',
    'Use the conventional feature-wise approach wherever workflow scheduling is required.'],
  ['', 'Formula Builder UI – Field Insertion Through Typing',
    'This works in current fields. For external feature fields, it won\'t work, as there could be fields with same names from multiple features.'],
  ['', 'Formula Builder – AI-Based Formula Writing/Editing Not Implemented',
    'Use manual formula entry instead.'],
  ['364', 'Organization Details → Basic Info: Website URL accepts invalid URL formats without validation.',
    'Expected: Validate the URL format and show an error message for invalid values, such as www.example or example@123.www.example'],
  ['', 'OCR component → Field Extraction: Field-level extraction (structured data extraction into specific fields) requires a paid API access token for OpenAI or Gemini, configured in the platform integrations settings.',
    'Use General Extraction for now'],
  ['', 'Builder Tool Not Available on Mobile Web',
    'The builder tool is not supported on mobile web. This is implemented as expected — builder functionality is restricted to desktop browsers by design. It should be available on Tab though.'],
  ['', 'Mobile – Formula Field Not Working in Tables & Charts',
    'Formula fields are not evaluated correctly when used inside Tables and Charts on mobile. This is under review.'],
];

// Full tester checklists (from templates/); minimal fallback if the files are missing.
const WHAT_TO_TEST_HTML = readTemplate('what-to-test.html', '<ul><li>Verify the release end-to-end.</li></ul>');
const WHAT_TO_TEST_MOBILE_HTML = readTemplate('what-to-test-mobile.html', '<ul><li>Verify the mobile app end-to-end.</li></ul>');

module.exports = {
  NONE_FEATURE_ROW,
  NONE_ENHANCEMENT_ROW,
  DEFAULT_KNOWN_ISSUES,
  WHAT_TO_TEST_HTML,
  WHAT_TO_TEST_MOBILE_HTML,
};
