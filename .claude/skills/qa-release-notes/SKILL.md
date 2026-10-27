---
name: qa-release-notes
description: >
  Use for the CADP internal QA build release notes (repo cadp-release-notes, "Release Notes
  V1.0.0 (N)", GitHub Pages release history): building or curating build N, bumping / rolling over
  after the QA mail is sent, undoing a wrong bump, moving a build's bugs Developed → Ready for
  Testing in OpenProject, publishing old builds to the history page, or debugging the scheduled
  workflow. NOT the in-app tenant "Release Notes" product feature. Triggers: "release notes build
  N", "send release notes to QA", "bump the version", "rollover", "move developed to ready for
  testing", "add old release notes", "release history page", "workflow failing".
---

# QA Build Release Notes

How the system works (data flow, OpenProject calls, state, config, file map): **read
`architecture.md` in this folder.** This file covers the procedures and the traps.

## Facts to check first
- State lives in `site/state.json` (`liveVersion`, `latestAnnouncedVersion`, `lastCutAt`). Local manual
  builds read `.env` (`LIVE_VERSION`, `RELEASE_CUTOFF_ISO`) — keep both in step. `git pull` first: the
  bot commits `site/` on every run.
- QA builds come from the GitLab **`qa`** branch. Read changelogs from `origin/qa`
  (`git archive origin/qa docs/changes`), never the working trees.
- The OpenProject token in `.env` is **Hemanth A (user 35)**: every status change shows as him, and it
  sees projects 1, 2, 3 (ADP), 6, 11 only — not RCF. Use another person's token only for that one
  job, passed as an env var, never written to a file.
- Bugs are counted by "last moved to Developed after `lastCutAt`" (UTC). Changelog entries by date
  `>=` the cut day.

## Build N for QA (curated)
1. Bugs: `reconcileDevelopedBugs({ cutoffIso })` with the previous build's cut.
2. Narrative: aggregate tagged `docs/changes` entries since the cut, then **curate by hand**
   (memory: feedback-qa-release-notes-curation): QA-visible items only, merged and rewritten; keep API
   (verify every path against the frontend's real calls), config and payload/caching rows; a Benefit on
   every enhancement; Known Issues = real open limitations only (many `known-issue` tags are fixes).
3. Render from a curated JSON with `render()` (`draft:false`), then `LIVE_VERSION=N node scripts/pdf-edge.js`.
   Never claim CavinGuard routing or AI buttons that don't exist (AI create = Create tab of
   GlobalAIAssistantWidget, page-driven).

## After the user sends the mail — bump N → N+1
- Preferred: Actions → Run workflow → tick **Bump**, `confirm_version` = current live N.
- **Trap — it sweeps every Developed bug**, including ones that reached Developed after the mailed
  draft was built. Before bumping, compare Developed bugs with the mailed bug list; if they differ,
  freeze N with only the mailed IDs, move only those, and set `lastCutAt` = the mailed draft's build
  time (done this way for v22: #2030 kept for v23). Dry-run first (`moveDevelopedToRft(ids, {dryRun:true})`).
- **Trap — the frozen PDF stays the DRAFT one** (ensurePdfs only backfills missing PDFs). Delete
  `site/release-notes-vN/index.pdf` after freezing; the next run rebuilds it.
- Then set `.env` to N+1 and the new cut.

## Undo a wrong bump
`git revert` the bot commit that did it ("chore(release-notes): update site", the one whose
`site/state.json` diff changes `liveVersion`), push, then Run workflow with Bump unticked. Check the
frozen page's bug table first: any bugs listed were moved to Ready for Testing and need moving back.

## Publish old builds to the history page
`node scripts/add-build.js --version N --html <page> [--pdf <pdf>]` or `--pdf <pdf> --date "<Month D, YYYY>"`
(PDF-only builds get a PDF.js page with no viewer chrome; `--also-pdf/--also-label` for a second
edition). Read every file before publishing — the site is public. Refuses existing/live builds without
`--force`.

## Other traps
- Pushing does not deploy Pages; only a workflow run does (scheduled runs come hours apart).
- A run that fails at "Fetch platform docs/changes" means a missing GitLab var/secret (the script only
  exits 1 on an empty `GITLAB_HOST`/`GROUP`/`TOKEN`; clone failures are silent "skip" lines).
- Sticky narrative: once a section is non-empty in `state.narrative`, new tagged entries stop being
  added to it until the next rollover — another reason to curate by hand.
- Repo files can be CRLF after a stash/checkout; multi-line text replacements then miss silently —
  verify edits landed.
