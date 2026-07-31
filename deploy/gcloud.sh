#!/usr/bin/env bash
# One-time, self-service deploy of cadp-release-notes to Google Cloud.
# Prereqs: gcloud CLI authenticated (`gcloud auth login`) with rights on $PROJECT.
#
# Usage:
#   PROJECT=your-gcp-project REGION=asia-south1 BUCKET=cadp-release-notes-xyz bash deploy/gcloud.sh
set -euo pipefail

: "${PROJECT:?set PROJECT}"
REGION="${REGION:-asia-south1}"
BUCKET="${BUCKET:-cadp-release-notes-$PROJECT}"
SERVICE="cadp-release-notes"
SA="${SERVICE}-sa"
SA_EMAIL="${SA}@${PROJECT}.iam.gserviceaccount.com"
TICK_MINUTES="${TICK_MINUTES:-3}"

gcloud config set project "$PROJECT"

echo "== Enable APIs =="
gcloud services enable run.googleapis.com cloudscheduler.googleapis.com \
  secretmanager.googleapis.com storage.googleapis.com cloudbuild.googleapis.com

echo "== GCS bucket =="
gcloud storage buckets create "gs://$BUCKET" --location="$REGION" 2>/dev/null || echo "bucket exists"

echo "== Runtime service account =="
gcloud iam service-accounts create "$SA" --display-name="cadp-release-notes runtime" 2>/dev/null || true
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:$SA_EMAIL" --role="roles/storage.objectAdmin"

echo "== Secrets (create empty if missing; add values with: gcloud secrets versions add NAME --data-file=-) =="
for s in openproject-token graph-client-secret git-read-token control-token; do
  gcloud secrets create "$s" --replication-policy=automatic 2>/dev/null || echo "  secret $s exists"
  gcloud secrets add-iam-policy-binding "$s" \
    --member="serviceAccount:$SA_EMAIL" --role="roles/secretmanager.secretAccessor" >/dev/null
done
echo "  -> populate values, e.g.:  printf '%s' \"\$TOKEN\" | gcloud secrets versions add openproject-token --data-file=-"

echo "== Build + deploy Cloud Run =="
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --service-account "$SA_EMAIL" \
  --allow-unauthenticated \
  --memory 512Mi \
  --set-env-vars "STORE_BACKEND=gcs,GCS_BUCKET=$BUCKET,OPENPROJECT_HOST=pmt.cavininfotech.com,OPENPROJECT_PROJECT_ID=3,LIVE_VERSION=19,RELEASE_MAIL_SUBJECT=CADP - QA Release,GRAPH_MAILBOX=hemanth.a@hepl.com" \
  --set-secrets "OPENPROJECT_TOKEN=openproject-token:latest,GRAPH_CLIENT_SECRET=graph-client-secret:latest,GIT_READ_TOKEN=git-read-token:latest,CONTROL_TOKEN=control-token:latest"

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
echo "Service URL: $URL"
gcloud run services update "$SERVICE" --region "$REGION" \
  --update-env-vars "PUBLIC_BASE_URL=$URL"

echo "== Cloud Scheduler → POST /tick (OIDC) every ${TICK_MINUTES} min =="
gcloud scheduler jobs create http "${SERVICE}-tick" \
  --location "$REGION" \
  --schedule "*/${TICK_MINUTES} * * * *" \
  --uri "${URL}/tick" \
  --http-method POST \
  --oidc-service-account-email "$SA_EMAIL" \
  --oidc-token-audience "$URL" 2>/dev/null \
  || gcloud scheduler jobs update http "${SERVICE}-tick" --location "$REGION" \
       --schedule "*/${TICK_MINUTES} * * * *" --uri "${URL}/tick"

cat <<EOF

Done.
  Live doc:   ${URL}/           (302 → latest /release-notes-v<N>/)
  Next steps: add secret values, set GRAPH_TENANT_ID/GRAPH_CLIENT_ID env, and (optional)
              map releasenotes.cavininfotech.com:
    gcloud beta run domain-mappings create --service $SERVICE --domain releasenotes.cavininfotech.com --region $REGION
EOF
