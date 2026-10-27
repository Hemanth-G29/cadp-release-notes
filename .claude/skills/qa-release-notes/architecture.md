# QA Build Release Notes — Architecture

> Scope: the CADP team's **internal, per-build QA release notes** (repo `cadp-release-notes`).
> NOT the in-app tenant "Release Notes" product feature (`cadp_frontend_reactjs/src/pages/workspace/release_notes/*`,
> `Services/cadp_client_ws_backend_nodejs/src/services/release*.service.js`). The two share no code.

## 1. Big picture

```
   ┌──────────────────────── SOURCES ─────────────────────────┐
   │                                                            │
   │  OpenProject (pmt.cavininfotech.com, project 3)            │   bugs  → "Bug Fixes"
   │    type=Bug(7), status=Developed(8)                        │
   │                                                            │
   │  GitLab platform repos (scm.ckdigital.in)                  │   tagged docs/changes entries →
   │    <repo>/docs/changes/*.md  (QA-Release-Note: <tag>)      │   Features / Enhancements / What to
   │    sparse-cloned into ./platform by fetch-platform-changes │   Test / Known Issues / API / Config
   │                                                            │
   │  content/*.md  (hand-curated Markdown-table manifests)     │   extra rows, merged before tags
   │  src/defaults.js (baseline Known Issues / What-to-Test)    │   fallback when a section is empty
   │                                                            │
   │  Outlook thread "CADP - QA Release" (Microsoft Graph)      │   rollover TRIGGER (version N sent)
   └────────────────────────────┬───────────────────────────────┘
                                │
                  ┌─────────────▼──────────────┐
   cron */15 ───► │  scripts/tick.js  (GH Actions) │   alt: Cloud Run src/server.js POST /tick
   dispatch ────► │                                │        (Cloud Scheduler, deploy/gcloud.sh)
                  │ 0. manual rollover? (guarded)  │
                  │ 1. svc.tickReconcile(store)    │──► reconcile bugs + build narrative + render DRAFT vN
                  │ 2. mailwatch.checkAndRollover  │──► new release mail? freeze vN, move bugs, open vN+1
                  │ 3. writeLatestIndex            │──► site/index.html → Release History page (all builds)
                  │ 4. ensurePdfs                  │──► index.pdf per version + latest.pdf
                  └─────────────┬──────────────────┘
                                │  store (src/store.js): pages | local | gcs
                  ┌─────────────▼──────────────┐
                  │ site/state.json             │  ← the ONLY durable state (committed to git)
                  │ site/release-notes-v<N>/    │     index.html (+ index.pdf)
                  │ site/latest.pdf, index.html │
                  └─────────────┬──────────────┘
                                │ workflow commits site/ "[skip ci]" → deploy-pages
                                ▼
                  GitHub Pages  https://<owner>.github.io/cadp-release-notes/
                  + in-thread Graph reply with rollover summary
```

## 2. Build lifecycle (versions)

A build number `N` is always in one of two states:

| State | Meaning | Rendered | Changes? |
|---|---|---|---|
| **live** (`state.liveVersion`) | build currently accumulating bugs/entries | with DRAFT banner, every tick | yes |
| **frozen** (`< liveVersion`) | announced to QA, cut | no banner | never (PDF backfilled once) |

**Rollover** (`src/rollover.js#performRollover`) turns live N into frozen N and opens N+1:

1. Fetch *all* bugs currently in Developed → render final (non-draft) HTML for N from `state.narrative` → `writeBuild(N)`.
2. `PATCH` each bug Developed(8) → Ready for Testing(16), `lockVersion`-safe, concurrency 5. Bugs no longer Developed are *skipped*, conflicts are *failed* (reported, not retried).
3. Write state: `liveVersion=N+1`, `latestAnnouncedVersion=N`, `lastCutAt=<cutoff>`, `bugs=[]`, narrative reset.

Two triggers, same function:

| Trigger | Cutoff (`lastCutAt`) | Guard |
|---|---|---|
| Mail: latest message with subject `CADP - QA Release`, body/subject matches `Release Notes V1.0.0 (N)` and `N > latestAnnouncedVersion` | mail `sentDateTime` | `lastProcessedMailId`, version compare |
| Manual: Actions → Run workflow → `rollover=true`, `confirm_version=<current live N>` | `now()` | confirm must equal `liveVersion` (no double bump); `dry_run` available |

After a mail rollover the service replies in-thread with `summaryText()` (moved IDs, skipped, failed, frozen/live links).

## 3. "Since the last build"

There are no git tags and no DB. The window is `state.lastCutAt` (ISO timestamp):

- **Bugs** (`src/reconcile.js`): no cutoff → every Developed bug. With cutoff → only bugs whose *last* "status changed … to Developed" activity (`GET /work_packages/{id}/activities`) is **after** the cutoff, UTC ms compare. One activity call per Developed bug per tick.
- **docs/changes** (`src/changelog.js#aggregate`): date-only compare `entry.date >= lastCutAt.slice(0,10)` → entries dated on the cut day are included (can repeat in two builds).

## 4. docs/changes parsing & routing (`src/changelog.js`)

- Scans `REPO_DIRS` (9 `Services/*` backends + `cadp_frontend_reactjs`) under `CHANGELOG_ROOT`, reading `docs/changes/*.md` except `index.md`. Module = file name.
- Entry = heading `/^##\s+(\d{4}-\d{2}-\d{2})\s*[—–-]\s*(.+?)\s*$/` up to the next `#`/`##` line.
- Field = `- **Name:**` text until the next top-level `\n- **`; nested bullets flattened and joined with `; `.
- Tag = `QA-Release-Note` → legacy `Release-Note` → `none`; lowercased, **first word only**.

| Tag | Section | Row built from |
|---|---|---|
| `feature` | New Features | name=title, description=What, impact=Why |
| `enhancement` | Enhancements | module=file name, description=What, benefit=Why |
| `test` | What to Test (under "This build — additional test focus") | `title — What` |
| `known-issue` | Known Issues | issue=`title — What`, workaround=**Why** |
| `api` | API Changes | endpoint=title, change=What |
| `config` | Configuration Changes | setting=title, change=What, reason=Why |
| `none` / anything else | dropped | — |

Bug fixes come **only** from OpenProject, so bug-fix changelog entries are tagged `none`.

## 5. Narrative merge (`src/service.js#buildNarrative`)

```
features      = pick(state.narrative.features,     [...content/new-features.md, ...feature tags])
enhancements  = pick(state.narrative.enhancements, [...content/enhancements.md, ...enhancement tags])
whatToTest    = pick(state.narrative.whatToTest,   test tags)
knownIssues   = [...content/known-issues.md,   ...known-issue tags]   (empty → DEFAULT_KNOWN_ISSUES)
apiChanges    = [...content/api-changes.md,    ...api tags]           (empty → "None" row)
configChanges = [...content/config-changes.md, ...config tags]        (empty → "None" row)
```
`pick` returns the first non-empty list. The result is written back to `state.narrative` every tick, so
the rollover can freeze exactly what was last rendered. (See the "sticky narrative" gotcha in SKILL.md.)

## 6. Rendering (`src/render.js`, `templates/*.html`)

- `{{PLACEHOLDER}}` string replacement over `templates/release-notes.html`: `TITLE, DRAFT_BANNER, VERSION,
  RELEASE_DATE, SUMMARY, NEW_FEATURES_ROWS, ENHANCEMENTS_ROWS, BUG_FIXES, CONFIG_CHANGES_ROWS,
  API_CHANGES_ROWS, KNOWN_ISSUES_ROWS, WHAT_TO_TEST, WHAT_TO_TEST_MOBILE`.
- Every value goes through `esc()`, so HTML in changelog text is shown as plain text.
- Bugs: v ≥ `bugTableFromVersion` (19) → `Bug ID | Description` table (OpenProject subject); older → comma list in groups of 10.
- Summary sentence is generated from the counts ("…delivers X bug fixes…").
- What to Test = `templates/what-to-test.html` baseline + `what-to-test-mobile.html` + tagged items.
- Release date = today in the OpenProject account timezone (`/users/me/preferences`, fallback `Asia/Kolkata`).
- PDF: `src/pdf.js` (Puppeteer, A4) in CI; `scripts/pdf-edge.js` (local Edge/Chrome) for `npm run build:mail`.

## 7. External APIs

| System | Call | Auth |
|---|---|---|
| OpenProject v3 | `GET /api/v3/projects/{id}/work_packages?filters=[type=7,status=8]&pageSize=100&offset=<page, 1-based>` | Basic `apikey:<OPENPROJECT_TOKEN>` |
| | `GET /api/v3/work_packages/{id}/activities` (time of move to Developed) | 〃 |
| | `GET /api/v3/users/me/preferences` (timezone) | 〃 |
| | `PATCH /api/v3/work_packages/{id}` `{lockVersion, _links.status → /api/v3/statuses/16}` (rollover only) | 〃 |
| MS Graph | `POST login.microsoftonline.com/{tenant}/oauth2/v2.0/token` (client credentials) | app secret |
| | `GET /v1.0/users/{mailbox}/messages?$filter=subject eq '…'&$orderby=sentDateTime desc&$top=1` | Bearer |
| | `POST /v1.0/users/{mailbox}/messages/{id}/reply` | Bearer |
| GitLab | `git clone --depth 1 --filter=blob:none --sparse` + `sparse-checkout set docs/changes` per repo, branch `PLATFORM_GITLAB_BRANCH` (= `qa`) | `GITLAB_TOKEN` (read_repository) |

## 8. Configuration

| Where | Name | Purpose |
|---|---|---|
| GH secret | `OPENPROJECT_TOKEN` | OpenProject API key (no fallback; missing → warning, calls fail) |
| GH secret | `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` | mail trigger; all unset → mail-watch skipped |
| GH secret | `GITLAB_TOKEN` | fetch docs/changes (was missing 2026-08-01 → 10-13: every run failed at the fetch step) |
| GH var | `PLATFORM_GITLAB_HOST`, `PLATFORM_GITLAB_GROUP`, `PLATFORM_GITLAB_BRANCH` (= `qa`, the branch QA builds from) | group unset → **no tagged narrative at all** |
| GH var | `LIVE_VERSION`, `GRAPH_MAILBOX` | initial live version, watched mailbox |
| workflow env | `STORE_BACKEND=pages`, `SITE_DIR=site`, `CONTENT_DIR=content`, `CHANGELOG_ROOT=platform` | |
| workflow input | `rollover`, `dry_run`, `confirm_version` | manual bump |
| local `.env` | anything above, plus `RELEASE_CUTOFF_ISO`, `BROWSER_PATH` | `src/config.js` has a tiny built-in loader |
| Cloud Run only | `GCS_BUCKET`, `CONTROL_TOKEN`, `TICK_MINUTES`, `PORT` | `/tick`, `/rollover`, `/approve` are **open** if `CONTROL_TOKEN` is unset |

## 9. How the tag gets into commits (platform side)

- The rule text is in root `C:\ADP\CLAUDE.md` and is appended to each `Services/*/CLAUDE.md` by `platform-rollout/apply.sh`.
  `cadp_frontend_reactjs/CLAUDE.md` does not carry it and relies on the root file.
- `git-hooks/pre-commit` in each repo blocks a commit whose staged `docs/changes/*.md` adds more `+## ` headings
  than `+- **QA-Release-Note:` lines. It checks only new entries.
- A GitLab CI enforcement layer was tried and removed (commit `6c0f3d6`).

## 10. Repo map

```
src/config.js        env + ids (TYPE_BUG=7, statuses, bugTableFromVersion=19, mail version regex)
src/openproject.js   API client (paging, activities, tz, moveStatus)
src/reconcile.js     live bug set for the window
src/changelog.js     docs/changes parse + tag routing
src/content.js       content/*.md table manifests
src/defaults.js      DEFAULT_KNOWN_ISSUES, baseline what-to-test
src/service.js       tickReconcile, buildNarrative, displayDate, latestVersion
src/rollover.js      performRollover, moveDevelopedToRft, summaryText
src/mailwatch.js     Graph watcher + in-thread reply
src/render.js        template fill, summary, bug table
src/store.js         local | pages | gcs backends (state + builds + pdf); pages writeLatestIndex → history page
src/history.js       Release History page, PDF-only build page (PDF.js), describeBuild
src/server.js        Cloud Run HTTP variant (/tick /rollover /approve /release-notes-v<N>/…)
src/pdf.js           Puppeteer PDF
scripts/tick.js      CI entrypoint
scripts/build-live.js, scripts/pdf-edge.js   local build / mail PDF
scripts/fetch-platform-changes.sh            GitLab sparse clone
scripts/add-build.js                         publish an old, already-sent build (page and/or PDF) into site/
templates/           release-notes.html, what-to-test*.html
content/             manual manifests
site/                published Pages tree (committed); state.json lives here
platform-rollout/    kit that pushed the tag rule + pre-commit hook into all platform repos
test/unit.test.js    node:test, parsing/render/routing only
```
Legacy manual scripts (pre-automation) live in `C:\ADP\open project\`. Do not extend them. `send_summary.js` there has a hardcoded Gmail app password, which should be rotated and removed.
