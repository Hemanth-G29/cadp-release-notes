# Release Notes Content (templates & manifests) — Change Log

## 2026-09-25 — Correct the AI What-to-Test flows and update Known Issues for build 20
- **Author:** hemanth.a
- **What:** Rewrote the "AI-Assisted Creation & Ask FAQ" What-to-Test section to match the real Cavin's AI assistant (Create / Ask tabs; the page you are on decides whether an application, module or feature is built). Removed steps for features that do not exist (refine/regenerate, "Create Module with AI" / "Create Feature with AI" buttons) and every CavinGuard verification step (CavinGuard is not implemented). Added a Known Issue: AI App Builder, AI Assistant Create and AI Ask FAQ do not work because the AI credentials moved from env to Vault but are not yet fetched from Vault. Removed the "AI Components blocked by LLM Gateway CORS" Known Issue.
- **Why:** QA reported test steps that could not be performed, and the AI features are down in this build.
- **QA-Release-Note:** none
- **Files:**
  - templates/what-to-test.html
  - content/known-issues.md

## 2026-10-13 — Remove the "AI down (Vault credentials)" known issue for build 21
- **Author:** hemanth.a
- **What:** Removed the Known Issue saying AI App Builder / AI Assistant Create / AI Ask FAQ do not work because the AI credentials moved to Vault, and the matching "blocked by a known issue" note in the AI What-to-Test section.
- **Why:** Build 21 ships the fix for that problem (OpenProject #1720 — AI Builder credentials missing), so QA retests the AI flows instead of skipping them.
- **QA-Release-Note:** none
- **Files:**
  - content/known-issues.md
  - templates/what-to-test.html
