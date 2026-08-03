#!/usr/bin/env bash
# Roll out the QA release-note discipline to ONE platform repo. Idempotent.
#   Layer 1 — appends the QA-Release-Note rule to CLAUDE.md, so Claude Code tags every docs/changes
#             entry (this is what actually drives the release notes).
#   Layer 3 — appends a pre-commit check to the repo's EXISTING git-hooks/pre-commit that blocks a
#             commit which ADDS an untagged docs/changes entry. Checks only newly-added entries, so it
#             never trips on untagged historical entries.
#
# There is intentionally NO GitLab CI layer: it needs a runner, adds a pipeline to every MR, and the
# CLAUDE.md rule + hook already cover it. (Earlier versions added one; `fix2.sh` removes it.)
#
# Usage: bash apply.sh <repo-path>   — commit on a branch that flows into the QA build (devops/dev) via MR.
set -uo pipefail
REPO="${1:?usage: apply.sh <repo-path>}"; [ -d "$REPO" ] || { echo "not a directory: $REPO"; exit 1; }
name="$(basename "$REPO")"; echo "== $name =="

# ---- Layer 1: CLAUDE.md rule ----
CLAUDE="$REPO/CLAUDE.md"
[ -f "$CLAUDE" ] || { printf '# %s — Claude Code Instructions\n' "$name" > "$CLAUDE"; echo "  created CLAUDE.md"; }
if grep -q 'QA-Release-Note' "$CLAUDE"; then
  echo "  Layer 1: CLAUDE.md already has the rule"
else
  cat >> "$CLAUDE" <<'MD'

---

## QA Release-Note Tag — required on every `docs/changes` entry

Every `docs/changes/<module>.md` entry you write **MUST** include a `QA-Release-Note:` line — the
per-change "does this go in the QA build release notes?" decision:

- **QA-Release-Note:** feature | enhancement | test | known-issue | api | config | none

`none` = do not include it (internal refactor / chore / bug fix). Any other value routes the entry into
the automated QA build release notes: `feature` → New Features, `enhancement` → Enhancements, `test` →
What to Test, `known-issue` → Known Issues, `api` → API Changes, `config` → Configuration Changes. Keep
the entry **title** and **What** customer-readable (they become the note text); for `known-issue`, put
the workaround in **Why**. Bug fixes are pulled from OpenProject automatically, so they stay `none`.
MD
  echo "  Layer 1: CLAUDE.md rule appended"
fi

# ---- Layer 3: pre-commit check via the repo's EXISTING git-hooks/ convention ----
# Reuse the repo's failure-safe postinstall (try/catch) so `npm install` in Docker/CI never fails.
REF="$(cd "$(dirname "$0")/../../Services/cadp_master_backend_nodejs" 2>/dev/null && pwd)"
if [ -f "$REPO/package.json" ]; then
  node -e '
    const fs=require("fs"); const [refP,tgtP]=process.argv.slice(1);
    const t=JSON.parse(fs.readFileSync(tgtP,"utf8")); t.scripts=t.scripts||{};
    if(!JSON.stringify(t.scripts).includes("core.hooksPath")){
      try{ t.scripts.postinstall=JSON.parse(fs.readFileSync(refP,"utf8")).scripts.postinstall;
           fs.writeFileSync(tgtP, JSON.stringify(t,null,2)+"\n");
           console.log("  Layer 3: failure-safe postinstall added (activates git-hooks on npm install)"); }catch(e){}
    } else console.log("  Layer 3: repo already configures core.hooksPath — left as-is");
  ' "$REF/package.json" "$REPO/package.json"
fi
mkdir -p "$REPO/git-hooks"
[ -f "$REPO/git-hooks/pre-commit" ] || { printf '#!/bin/sh\n' > "$REPO/git-hooks/pre-commit"; chmod +x "$REPO/git-hooks/pre-commit"; }
if grep -q 'QA release-note tag check' "$REPO/git-hooks/pre-commit"; then
  echo "  Layer 3: git-hooks/pre-commit already has the check"
else
  cat >> "$REPO/git-hooks/pre-commit" <<'SH'

# --- QA release-note tag check (only NEWLY-ADDED entries) ---
for f in $(git diff --cached --name-only --diff-filter=ACM -- 'docs/changes/*.md' 2>/dev/null | grep -iv 'INDEX.md'); do
  ne=$(git diff --cached -U0 -- "$f" | grep -cE '^\+## ')
  nt=$(git diff --cached -U0 -- "$f" | grep -cE '^\+[[:space:]]*-[[:space:]]*\*\*QA-Release-Note:')
  if [ "$ne" -gt "$nt" ]; then
    echo "[pre-commit] $f: a newly-added changelog entry is missing a QA-Release-Note tag."
    echo "[pre-commit] Add: - **QA-Release-Note:** feature | enhancement | test | known-issue | api | config | none  (bypass: git commit --no-verify)"
    exit 1
  fi
done
SH
  echo "  Layer 3: appended QA check to git-hooks/pre-commit"
fi
echo
