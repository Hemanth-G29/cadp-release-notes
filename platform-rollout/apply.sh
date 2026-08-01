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

# ---- Layer 3: local pre-commit hook (catches an untagged entry at `git commit` time) ----
mkdir -p "$REPO/.githooks"
cat > "$REPO/.githooks/pre-commit" <<'SH'
#!/usr/bin/env bash
# Block a commit if a STAGED docs/changes entry is missing a QA-Release-Note tag.
# Bypass in an emergency with: git commit --no-verify
set -uo pipefail
mapfile -t files < <(git diff --cached --name-only --diff-filter=ACM -- 'docs/changes/*.md' ':(exclude)**/INDEX.md' 2>/dev/null || true)
fail=0
for f in "${files[@]}"; do
  content=$(git show ":$f" 2>/dev/null || true)   # the STAGED version
  [ -n "$content" ] || continue
  entries=$(grep -cE '^## ' <<<"$content" || true)
  tags=$(grep -cE '^[[:space:]]*-[[:space:]]*\*\*QA-Release-Note:\*\*' <<<"$content" || true)
  if [ "$entries" -ne "$tags" ]; then
    echo "❌ commit blocked — $f: $entries changelog entr$([ "$entries" = 1 ] && echo y || echo ies) but $tags QA-Release-Note tag(s)."
    fail=1
  fi
done
if [ "$fail" -ne 0 ]; then
  echo "   Add to each entry: - **QA-Release-Note:** feature | enhancement | test | known-issue | api | config | none"
  echo "   (emergency bypass: git commit --no-verify)"
  exit 1
fi
exit 0
SH
chmod +x "$REPO/.githooks/pre-commit"

# Auto-activate on `npm install` via a prepare script (git hooks aren't shared otherwise).
if [ -f "$REPO/package.json" ]; then
  node -e '
    const fs=require("fs"), p=process.argv[1];
    const j=JSON.parse(fs.readFileSync(p,"utf8"));
    j.scripts=j.scripts||{};
    const cmd="git config core.hooksPath .githooks";
    if(!j.scripts.prepare) j.scripts.prepare=cmd;
    else if(!j.scripts.prepare.includes("core.hooksPath")) j.scripts.prepare=j.scripts.prepare+" && "+cmd;
    fs.writeFileSync(p, JSON.stringify(j,null,2)+"\n");
  ' "$REPO/package.json" && echo "  Layer 3: pre-commit hook installed + prepare script wired (npm install activates it)"
else
  echo "  Layer 3: pre-commit hook installed — no package.json; devs run once: git config core.hooksPath .githooks"
fi
echo

