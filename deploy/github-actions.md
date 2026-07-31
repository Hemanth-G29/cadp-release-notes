# Deploy via GitHub Actions (keyless, Workload Identity Federation)

The workflow at `.github/workflows/deploy.yml` runs the unit tests, then builds + deploys to Cloud
Run on every push to `main` (or manually via *Run workflow*). It authenticates to Google Cloud with
**Workload Identity Federation** — no service-account JSON key is stored in GitHub. App secrets stay
in Secret Manager and are wired via `--set-secrets`, so they never touch the workflow.

## One-time GCP setup

First provision the infra (bucket, runtime service account, Secret Manager entries). The easiest way
is to run the bootstrap parts of `deploy/gcloud.sh` once, or create them by hand. Then set up WIF:

```bash
PROJECT=your-gcp-project
REPO=your-org/cadp-release-notes            # GitHub owner/repo
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')

# 1. Workload Identity pool + GitHub OIDC provider (restricted to your repo).
gcloud iam workload-identity-pools create github \
  --project="$PROJECT" --location=global --display-name="GitHub"

gcloud iam workload-identity-pools providers create-oidc github-provider \
  --project="$PROJECT" --location=global --workload-identity-pool=github \
  --display-name="GitHub OIDC" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='${REPO}'"

# 2. A deploy service account, and let ONLY this repo impersonate it.
gcloud iam service-accounts create cadp-rn-deployer --project="$PROJECT"
DEPLOYER="cadp-rn-deployer@${PROJECT}.iam.gserviceaccount.com"

gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER" --project="$PROJECT" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/${REPO}"

# 3. Roles the deployer needs to build + deploy.
for r in roles/run.admin roles/cloudbuild.builds.editor roles/artifactregistry.writer \
         roles/storage.admin roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:${DEPLOYER}" --role="$r"
done

# 4. Allow the deployer to actAs the runtime SA (created by gcloud.sh: cadp-release-notes-sa).
gcloud iam service-accounts add-iam-policy-binding \
  "cadp-release-notes-sa@${PROJECT}.iam.gserviceaccount.com" --project="$PROJECT" \
  --role=roles/iam.serviceAccountUser --member="serviceAccount:${DEPLOYER}"

# Provider resource name for the GitHub secret below:
echo "projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/providers/github-provider"
```

## GitHub configuration

Repo **Secrets** (Settings → Secrets and variables → Actions → Secrets):

| Secret | Value |
|---|---|
| `GCP_WIF_PROVIDER` | the provider resource name printed above |
| `GCP_DEPLOY_SA` | `cadp-rn-deployer@<project>.iam.gserviceaccount.com` |
| `GCP_RUNTIME_SA` | `cadp-release-notes-sa@<project>.iam.gserviceaccount.com` |

Repo **Variables** (non-secret):

| Variable | Example |
|---|---|
| `GCP_PROJECT` | `your-gcp-project` |
| `GCP_REGION` | `asia-south1` |
| `GCS_BUCKET` | `cadp-release-notes-your-gcp-project` |
| `LIVE_VERSION` | `19` |
| `GRAPH_MAILBOX` | `hemanth.a@hepl.com` |
| `GRAPH_TENANT_ID` | `<entra tenant id>` (leave blank until Graph is set up) |
| `GRAPH_CLIENT_ID` | `<entra app client id>` (leave blank until Graph is set up) |

App secrets live in **Secret Manager** (created by `deploy/gcloud.sh`): `openproject-token`,
`graph-client-secret`, `git-read-token`, `control-token`. The workflow references them by name; add
their values with `gcloud secrets versions add <name> --data-file=-`.

## Trigger

Push to `main` (paths under `src/`, `templates/`, `Dockerfile`, `package.json`) or run the workflow
manually. The job prints the deployed URL to the run summary.
