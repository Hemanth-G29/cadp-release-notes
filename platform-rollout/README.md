# Platform rollout — QA release-note discipline

Makes the release-notes auto-tracking actually get fed, by ensuring every `docs/changes` entry across
the platform repos carries a `QA-Release-Note:` tag.

- **Layer 1 (required):** appends the tagging rule to each repo's `CLAUDE.md`, so Claude Code tags
  every changelog entry. Without this, the GitLab aggregator finds nothing.
- **Layer 2 (CI enforcement):** a GitLab CI job (`ci/check-qa-release-note.sh` + a `.gitlab-ci.yml` job)
  that fails a **merge request** if any changed `docs/changes` entry is missing the tag. Requires a
  GitLab runner.
- **Layer 3 (pre-commit hook):** appends the tag check to each repo's **existing `git-hooks/pre-commit`**
  (the repos already set `core.hooksPath git-hooks` via a *failure-safe* `postinstall`). Blocks a local
  `git commit` when a staged `docs/changes` entry is untagged. Best-effort (per-clone; bypassable with
  `--no-verify`). **Do NOT** add a bare `git config core.hooksPath` to `prepare` — it runs during
  `npm install` in Docker/CI where git is absent and hard-fails the build (this happened once; see `fix.sh`).

> `fix.sh <repo>` repairs a repo that got the earlier broken Layer 3 (removes the naked `prepare` and
> stray `.githooks/`, moves the check into `git-hooks/pre-commit`). `apply.sh` now does the right thing.

## Apply to one repo

```bash
bash apply.sh /path/to/<platform-repo>
```
Idempotent. It appends to `CLAUDE.md`, adds `ci/check-qa-release-note.sh`, and creates `.gitlab-ci.yml`
with the check job (if the repo has no CI yet; otherwise it tells you to merge the job — see
`gitlab-ci.snippet.yml`).

## Apply to all repos

```bash
for r in \
  ../../Services/cadp_master_backend_nodejs ../../Services/cadp_rbac_backend_nodejs \
  ../../Services/cadp_client_ws_backend_nodejs ../../Services/cadp_clientws_metadata_backend_nodejs \
  ../../Services/cadp_workflow_backend_nodejs ../../Services/cadp_notification_backend_nodejs \
  ../../Services/cadp_chat_backend_nodejs ../../Services/cadp_platform_search_backend_nodejs \
  ../../Services/cadp_template_backend_nodejs ../../cadp_frontend_reactjs ; do
  bash apply.sh "$r"
done
```

## Then, per repo
Apply on a branch that flows into the QA build (**`devops/dev`**), review the diff, and open a merge
request. On the next `devops/dev → qa` merge, the tags are in the QA build and the release-notes
service (reading the `qa` branch) picks them up.

> Note: the CI job needs a GitLab runner. If your projects don't run GitLab CI (deploys go through the
> external Azure pipeline), Layer 1 still works on its own; enable Layer 2 only where a runner exists.
