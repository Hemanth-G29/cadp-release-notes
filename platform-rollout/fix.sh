#!/usr/bin/env bash
# FIX a botched Layer-3 rollout: remove the naked `prepare` (which broke Docker/Jenkins builds
# because git isn't in the build image), drop the stray .githooks/, and add the QA-Release-Note
# check to the repo's EXISTING git-hooks/pre-commit (matching each repo's own convention).
# Usage: bash fix.sh <repo-path>
set -uo pipefail
REF="$(cd "$(dirname "$0")/../../Services/cadp_master_backend_nodejs" 2>/dev/null && pwd)"  # failure-safe postinstall source
REPO="${1:?usage: fix.sh <repo-path>}"; name="$(basename "$REPO")"
echo "== $name =="

# 1) remove the stray .githooks/ I added
[ -d "$REPO/.githooks" ] && { rm -rf "$REPO/.githooks"; echo "  removed stray .githooks/"; }

# 2) package.json: drop my naked prepare; add a failure-safe postinstall only if the repo has no hook config
node -e '
  const fs=require("fs"); const [refP,tgtP]=process.argv.slice(1);
  const t=JSON.parse(fs.readFileSync(tgtP,"utf8")); t.scripts=t.scripts||{}; let changed=false;
  if(t.scripts.prepare==="git config core.hooksPath .githooks"){ delete t.scripts.prepare; changed=true; console.log("  removed naked prepare (build-breaker)"); }
  if(!JSON.stringify(t.scripts).includes("core.hooksPath")){
    try{ const ref=JSON.parse(fs.readFileSync(refP,"utf8")); t.scripts.postinstall=ref.scripts.postinstall; changed=true; console.log("  added failure-safe postinstall (git-hooks)"); }catch(e){ console.log("  (could not read reference postinstall)"); }
  }
  if(changed) fs.writeFileSync(tgtP, JSON.stringify(t,null,2)+"\n"); else console.log("  package.json already clean");
' "$REF/package.json" "$REPO/package.json" 2>/dev/null || echo "  (no package.json)"

# 3) ensure git-hooks/pre-commit exists, then append the QA check (idempotent, POSIX sh)
mkdir -p "$REPO/git-hooks"
[ -f "$REPO/git-hooks/pre-commit" ] || { printf '#!/bin/sh\n' > "$REPO/git-hooks/pre-commit"; chmod +x "$REPO/git-hooks/pre-commit"; }
if grep -q 'QA-Release-Note' "$REPO/git-hooks/pre-commit"; then
  echo "  git-hooks/pre-commit already has the QA check"
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
  echo "  appended QA check to git-hooks/pre-commit"
fi
echo
