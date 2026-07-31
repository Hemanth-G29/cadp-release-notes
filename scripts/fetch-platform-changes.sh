#!/usr/bin/env bash
# Fetch ONLY docs/changes/*.md from each platform repo on GitLab into $CHANGELOG_ROOT (default
# ./platform), in the layout the aggregator expects (Services/<svc>/docs/changes and
# cadp_frontend_reactjs/docs/changes). Shallow + sparse: no history, only the docs/changes tree.
#
# Env: GITLAB_HOST (e.g. scm.ckdigital.in), GITLAB_GROUP (e.g. cadp_platform_services),
#      GITLAB_TOKEN (read_repository), GITLAB_BRANCH (default devops/dev), CHANGELOG_ROOT (default platform).
set -uo pipefail

: "${GITLAB_HOST:?set GITLAB_HOST}"
: "${GITLAB_GROUP:?set GITLAB_GROUP}"
: "${GITLAB_TOKEN:?set GITLAB_TOKEN}"
BRANCH="${GITLAB_BRANCH:-devops/dev}"
DEST="${CHANGELOG_ROOT:-platform}"

# GitLab repo name → local path (must match REPO_DIRS in src/changelog.js).
mapfile -t ENTRIES <<'EOF'
cadp_master_backend_nodejs Services/cadp_master_backend_nodejs
cadp_rbac_backend_nodejs Services/cadp_rbac_backend_nodejs
cadp_client_ws_backend_nodejs Services/cadp_client_ws_backend_nodejs
cadp_clientws_metadata_backend_nodejs Services/cadp_clientws_metadata_backend_nodejs
cadp_workflow_backend_nodejs Services/cadp_workflow_backend_nodejs
cadp_notification_backend_nodejs Services/cadp_notification_backend_nodejs
cadp_chat_backend_nodejs Services/cadp_chat_backend_nodejs
cadp_platform_search_backend_nodejs Services/cadp_platform_search_backend_nodejs
cadp_template_backend_nodejs Services/cadp_template_backend_nodejs
cadp_frontend_reactjs cadp_frontend_reactjs
EOF

rm -rf "$DEST"
for line in "${ENTRIES[@]}"; do
  repo="${line%% *}"; sub="${line##* }"
  path="$DEST/$sub"
  url="https://oauth2:${GITLAB_TOKEN}@${GITLAB_HOST}/${GITLAB_GROUP}/${repo}.git"
  if git clone --depth 1 --filter=blob:none --sparse --branch "$BRANCH" "$url" "$path" >/dev/null 2>&1; then
    git -C "$path" sparse-checkout set docs/changes >/dev/null 2>&1 || true
    echo "  ok   $repo"
  else
    echo "  skip $repo (branch '$BRANCH' missing or no access)"
  fi
done

n=$(find "$DEST" -path '*/docs/changes/*.md' 2>/dev/null | grep -vi INDEX | wc -l | tr -d ' ')
echo "docs/changes files fetched: $n"
