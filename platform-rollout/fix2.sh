#!/usr/bin/env bash
# Fix round 2:
#  (a) remove the Layer-2 GitLab CI (.gitlab-ci.yml + ci/) — it added a surprise MR pipeline and its
#      whole-file tag count fails on any docs/changes file that has untagged historical entries.
#  (b) fix the git-hooks/pre-commit QA check to validate only NEWLY-ADDED entries (diff-based),
#      so it no longer trips on historical untagged entries.
# Usage: bash fix2.sh <repo-path>
set -uo pipefail
REPO="${1:?usage: fix2.sh <repo-path>}"; name="$(basename "$REPO")"
echo "== $name =="

# (a) remove the CI we added (these repos had no .gitlab-ci.yml before the rollout)
if [ -f "$REPO/.gitlab-ci.yml" ] && grep -q 'qa-release-note-check' "$REPO/.gitlab-ci.yml"; then
  rm -f "$REPO/.gitlab-ci.yml"; echo "  removed .gitlab-ci.yml"
fi
if [ -f "$REPO/ci/check-qa-release-note.sh" ]; then
  rm -f "$REPO/ci/check-qa-release-note.sh"; rmdir "$REPO/ci" 2>/dev/null || true; echo "  removed ci/check-qa-release-note.sh"
fi

# (b) replace the pre-commit QA block with a diff-based (added-entries-only) check
PC="$REPO/git-hooks/pre-commit"
if [ -f "$PC" ] && grep -q 'QA release-note tag check' "$PC"; then
  sed -i '/# --- QA release-note tag check/,$d' "$PC"
  cat >> "$PC" <<'SH'

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
  echo "  fixed pre-commit QA check (added-entries only)"
fi
echo
