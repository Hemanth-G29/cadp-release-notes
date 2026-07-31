# cadp-release-notes

> **Scope — read this first.** This service produces the **CADP team's internal QA build release
> notes** (per build, generated from OpenProject bugs + `docs/changes`, consumed by the QA team;
> the `BUILD17/18/19…` documents, "Environment: QA"). It is **NOT** the in-app **Release Notes
> product feature** that tenants use to publish release notes to their own clients — that is separate
> code, data, and audience. They may share the words "release notes"; keep them distinct. The
> changelog classifier tag is therefore `QA-Release-Note:` (not `Release-Note:`).

Automated, always-current CADP **QA build** release notes. One document per build, hosted in the
cloud, that keeps itself up to date:

- **Bug fixes** — pulled from OpenProject every few minutes (correct pagination), rendered as a
  **Bug ID | Description** table (v19+; Description = the bug's OpenProject subject). Legacy builds
  (≤ v18) keep the comma-joined ID list.
- **New Features / Enhancements / What-to-Test** — auto-drafted from each repo's
  `docs/changes/*.md` entries tagged `Release-Note:`, then human-approved.
- **Version rollover** — driven by the `CADP - QA Release` Outlook thread. When you send the
  mail announcing `Release Notes V1.0.0 (N)`, the service freezes vN, **moves vN's bugs
  Developed → Ready for Testing**, opens **v(N+1)**, and **replies in the thread** with the summary.
- **URLs** — `…/release-notes-v19/`, `…/release-notes-v20/`, one permanent URL per build; `/`
  redirects to the latest. PDF at `…/release-notes-v<N>/current.pdf`.

**Deployment: fully GitHub-native (default).** A scheduled GitHub Actions workflow *is* the tick, and
**GitHub Pages** hosts the docs — **no GCP, no server, no laptop, no OpenProject admin**. (A Cloud Run
variant also exists as an alternative for private hosting — see the bottom.)

> ⚠️ **Visibility:** GitHub Pages on a personal/free repo is **public** — the published pages (which
> include internal OpenProject bug descriptions) would be world-readable. Use a repo/org with GitHub
> Enterprise **private Pages**, or switch to the Cloud Run variant, if that data must stay internal.

## Architecture

```
OpenProject (REST poll)          Outlook "CADP - QA Release" thread (Microsoft Graph)
        \                          /
         Cloud Run: cadp-release-notes (Go/Node HTTP)
        /            |             \
 Cloud Scheduler   GCS bucket   Secret Manager
 (POST /tick)   (state + builds)  (tokens/creds)
```

## How each section is populated

| Section | Source | How to feed it |
|---|---|---|
| **Bug Fixes** | OpenProject (live) | automatic — Developed bugs each run |
| **New Features** | `docs/changes` tag | entry tagged `QA-Release-Note: feature` |
| **Enhancements** | `docs/changes` tag | `QA-Release-Note: enhancement` |
| **What to Test** | baseline + tag | `QA-Release-Note: test` (appended under "additional test focus") |
| **Known Issues** | manifest + tag + baseline | `QA-Release-Note: known-issue`, or `content/known-issues.md`; else built-in baseline |
| **API Changes** | manifest + tag | `QA-Release-Note: api`, or `content/api-changes.md`; else "None" |
| **Config Changes** | manifest + tag | `QA-Release-Note: config`, or `content/config-changes.md`; else "None" |

**Primary path = the `QA-Release-Note:` tag.** Devs use Claude Code, which writes the
`docs/changes/<module>.md` entries per the platform `CLAUDE.md` rule — that rule now requires the tag
on every entry, so all six narrative sections fill themselves as code is committed. Point the workflow
at the platform repo (set the `PLATFORM_REPO` variable) so the aggregator can read those entries.

**Optional manual manifests** (`content/*.md`) cover items with no code-change entry — long-standing
known issues, or an API/config note. Precedence: **approved state › manifest › tag › baseline/None**.

### Auto-tracking narrative from GitLab (docs/changes tags)

To have New Features / Enhancements / etc. fill themselves from the platform repos' `docs/changes`
`QA-Release-Note:` tags, the workflow shallow-sparse-clones **only `docs/changes/`** from each GitLab
repo (`scripts/fetch-platform-changes.sh`) and points the aggregator at it. Enable it with:

- **Repo variables:** `PLATFORM_GITLAB_HOST` = `scm.ckdigital.in`, `PLATFORM_GITLAB_GROUP` =
  `cadp_platform_services`, `PLATFORM_GITLAB_BRANCH` = the QA branch (e.g. `devops/dev`).
- **Repo secret:** `GITLAB_TOKEN` = a GitLab token with **`read_repository`** scope.

Only entries **tagged** `QA-Release-Note:` and **dated after the last release cut** appear — so a
section stays empty until tagged commits land (Claude Code adds the tag per each repo's `CLAUDE.md`).
If the group var is unset, this step is skipped and narrative comes from the manual manifests only.

## Routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | 302 → latest `/release-notes-v<N>/` |
| GET | `/release-notes-v<N>/` | The build's HTML (live one auto-updates; older are frozen) |
| GET | `/release-notes-v<N>/current.pdf` | PDF (needs Chromium; bundled in the image) |
| POST | `/tick` | Reconcile Developed bugs + mail-watch. Called by Cloud Scheduler. *(control token)* |
| POST | `/rollover` | Manual rollover override (`{dryRun,releaseDate,cutoffIso,mailId}`). *(control token)* |
| POST | `/approve` | Set/approve narrative (`{narrative:{features,enhancements,...}}`). *(control token)* |
| GET | `/healthz` | Liveness |

## Local development

```bash
cp .env.example .env        # fill OPENPROJECT_TOKEN (or rely on the dev fallback)
npm run build:live          # generate ./out/Release_Notes_V1.0.0_BUILD<live>.html from live data
npm start                   # run the HTTP server on :8080 (STORE_BACKEND=local → ./out)
```

Key env vars: see `.env.example`. `STORE_BACKEND=local` writes under `./out`; `gcs` uses `GCS_BUCKET`.
Set `CHANGELOG_ROOT` to a checkout root to enable narrative auto-drafting from `docs/changes`.

## Deploy — GitHub Pages (default, no GCP)

Runtime = the scheduled workflow `.github/workflows/release-notes.yml`; host = GitHub Pages. Setup:

1. **Push this repo to GitHub.** Consider a **private** repo (see the visibility warning above).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. **Settings → Secrets and variables → Actions:**
   - Secrets: `OPENPROJECT_TOKEN`, and (for mail-driven rollover) `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`.
   - Variables: `LIVE_VERSION` (e.g. `19`), `GRAPH_MAILBOX` (e.g. `hemanth.a@hepl.com`).
4. **Actions → "Release Notes" → Run workflow** (first run), or wait for the 15-min schedule.

Result — always-on, laptop-off:
- The workflow runs every ~15 min on GitHub's servers: reconciles Developed bugs, checks the
  `CADP - QA Release` thread, rebuilds `site/`, commits it (durable state + frozen builds), and
  deploys it to Pages.
- URLs: `https://<owner>.github.io/<repo>/` → redirects to the latest;
  `…/release-notes-v19/`, `…/release-notes-v20/` per build.

**PDF:** each version is also published as a PDF next to its page — `…/release-notes-v<N>/index.pdf` —
generated in the workflow (headless Chromium) and committed alongside the HTML. The live version's PDF
is also copied to `…/latest.pdf` for a stable download link, and every page has a "⬇ Download PDF"
link. The live version's PDF is regenerated each run (so it stays current); frozen versions are
generated once. If you'd rather avoid the per-run binary churn, restrict PDF generation to rollover
only (one line in `scripts/tick.js`).

> Note: GitHub cron is best-effort (may be delayed/batched under load) and pauses after 60 days of
> repo inactivity — fine for release notes.

## Alternative — private hosting on Cloud Run (needs GCP)

If the bug data must stay private and you have GCP: `deploy/gcloud.sh` provisions Cloud Run + Cloud
Scheduler + GCS + Secret Manager, and `deploy/github-actions.md` describes a keyless (WIF) deploy
workflow. Set `STORE_BACKEND=gcs`. This path keeps the pages non-public.

## Microsoft Graph (mail-driven rollover)

Register an Entra app with **application** permissions `Mail.Read` + `Mail.Send`, admin-consented,
and (recommended) scope it to just the release mailbox with an
[application access policy](https://learn.microsoft.com/en-us/graph/auth-limit-mailbox-access).
Put `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID` in env and `graph-client-secret` in Secret Manager. Until
these are set, mail-watch no-ops and bug tracking still runs.

## Security notes

- No secrets in source. The only fallback is a dev OpenProject token in `src/config.js` that mirrors
  the one already in `../open project/*.js`; **rotate it into Secret Manager and delete the fallback**
  (that token and the Gmail app password in `../open project/send_summary.js` are exposed in git and
  should be rotated).
- Control routes (`/tick`, `/rollover`, `/approve`) require `CONTROL_TOKEN`; in production, prefer
  Cloud Scheduler → Cloud Run **OIDC** and restrict ingress.
