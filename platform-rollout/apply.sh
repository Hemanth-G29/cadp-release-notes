#!/usr/bin/env bash
# Roll out the QA release-note discipline to ONE platform repo. Idempotent.
#   Layer 1 — appends the QA-Release-Note rule to the repo's CLAUDE.md (creates it if missing),
#             so Claude Code tags every docs/changes entry.
#   Layer 2 — installs ci/check-qa-release-note.sh + a .gitlab-ci.yml job that FAILS a merge request
#             if any changed docs/changes entry is missing a QA-Release-Note tag.
#
# Usage: bash apply.sh <path-to-repo>
# Apply on a branch that flows into the QA build (i.e. devops/dev), then open an MR.
set -uo pipefail
REPO="${1:?usage: apply.sh <repo-path>}"
[ -d "$REPO" ] || { echo "not a directory: $REPO"; exit 1; }
name="$(basename "$REPO")"
echo "== $name =="

# ---- Layer 1: CLAUDE.md rule ----
CLAUDE="$REPO/CLAUDE.md"
[ -f "$CLAUDE" ] || { printf '# %s — Claude Code Instructions\n' "$name" > "$CLAUDE"; echo "  created CLAUDE.md"; }
if grep -q 'QA-Release-Note' "$CLAUDE"; then
  echo "  Layer 1: CLAUDE.md already has the rule — skipped"
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

# ---- Layer 2: CI check script ----
mkdir -p "$REPO/ci"
cat > "$REPO/ci/check-qa-release-note.sh" <<'SH'
#!/usr/bin/env bash
# Fail if any docs/changes/*.md entry changed in this MR is missing a QA-Release-Note tag.
# Arg 1 = the base commit/ref to diff against (GitLab: $CI_MERGE_REQUEST_DIFF_BASE_SHA).
set -uo pipefail
BASE="${1:-origin/devops/dev}"
mapfile -t files < <(git diff --name-only "$BASE" HEAD -- 'docs/changes/*.md' ':(exclude)**/INDEX.md' 2>/dev/null || true)
fail=0
for f in "${files[@]}"; do
  [ -f "$f" ] || continue   # deleted file
  entries=$(grep -cE '^## ' "$f" || true)
  tags=$(grep -cE '^[[:space:]]*-[[:space:]]*\*\*QA-Release-Note:\*\*' "$f" || true)
  if [ "$entries" -ne "$tags" ]; then
    echo "FAIL  $f — $entries entries but $tags QA-Release-Note tags (every entry needs exactly one)."
    fail=1
  fi
done
[ "$fail" -eq 0 ] && echo "OK: every changed docs/changes entry carries a QA-Release-Note tag."
exit $fail
SH
chmod +x "$REPO/ci/check-qa-release-note.sh"
echo "  Layer 2: ci/check-qa-release-note.sh installed"

# ---- Layer 2: .gitlab-ci.yml job ----
GLCI="$REPO/.gitlab-ci.yml"
if [ -f "$GLCI" ]; then
  grep -q 'qa-release-note-check' "$GLCI" \
    && echo "  Layer 2: .gitlab-ci.yml already has the job — skipped" \
    || echo "  Layer 2: ⚠ .gitlab-ci.yml exists — add the job manually (see platform-rollout/gitlab-ci.snippet.yml)"
else
  cat > "$GLCI" <<'YML'
# QA release-note enforcement: fails a merge request if a docs/changes entry lacks a QA-Release-Note tag.
# Requires a GitLab runner. If the project already has a .gitlab-ci.yml, merge this job into it instead.
qa-release-note-check:
  stage: test
  image: alpine:3.20
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
  variables:
    GIT_DEPTH: "0"
  before_script:
    - apk add --no-cache git bash
  script:
    - bash ci/check-qa-release-note.sh "${CI_MERGE_REQUEST_DIFF_BASE_SHA:-origin/devops/dev}"
YML
  echo "  Layer 2: .gitlab-ci.yml created with the check job"
fi

# ---- Layer 3: pre-commit hook via the repo's EXISTING git-hooks/ convention ----
# DO NOT add a bare `git config core.hooksPath` to package.json `prepare` — it runs during
# `npm install` in Docker/CI where git is absent and HARD-FAILS the build (exit 127). Reuse the
# repo's failure-safe postinstall (try/catch) and append the check to its real git-hooks/pre-commit.
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
if grep -q 'QA-Release-Note' "$REPO/git-hooks/pre-commit"; then
  echo "  Layer 3: git-hooks/pre-commit already has the QA check"
else
  cat >> "$REPO/git-hooks/pre-commit" <<'SH'

# --- QA release-note tag check (release-notes rollout) ---
for f in $(git diff --cached --name-only --diff-filter=ACM -- 'docs/changes/*.md' 2>/dev/null | grep -iv 'INDEX.md'); do
  e=$(git show ":$f" 2>/dev/null | grep -c '^## ')
  t=$(git show ":$f" 2>/dev/null | grep -c 'QA-Release-Note:')
  if [ "$e" -ne "$t" ]; then
    echo "[pre-commit] $f: $e changelog entries but $t QA-Release-Note tag(s)."
    echo "[pre-commit] Add: - **QA-Release-Note:** feature | enhancement | test | known-issue | api | config | none  (bypass: git commit --no-verify)"
    exit 1
  fi
done
SH
  echo "  Layer 3: appended QA check to git-hooks/pre-commit"
fi
echo

