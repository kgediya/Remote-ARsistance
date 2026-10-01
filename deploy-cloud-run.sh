#!/usr/bin/env bash
set -euo pipefail

project_id="${REMOTE_ARSISTANCE_GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
region="${REMOTE_ARSISTANCE_GCP_REGION:-us-central1}"
service="remote-arsistance"
source_dir="$(cd "$(dirname "$0")/Websocket Server" && pwd)"

if [[ -z "$project_id" || "$project_id" == "(unset)" ]]; then
  echo "Set REMOTE_ARSISTANCE_GCP_PROJECT to the Google Cloud project ID." >&2
  exit 1
fi
if [[ -z "$(gcloud auth list --filter='status:ACTIVE' --format='value(account)')" ]]; then
  echo "Sign in with gcloud auth login before deploying." >&2
  exit 1
fi

relayview_region="${RELAYVIEW_REGION:-}"
if [[ -z "$relayview_region" ]]; then
  if [[ "$region" == *"asia"* ]]; then
    relayview_region="IN"
  else
    relayview_region="US"
  fi
fi

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project "$project_id"
gcloud run deploy "$service" \
  --project "$project_id" \
  --region "$region" \
  --source "$source_dir" \
  --allow-unauthenticated \
  --min-instances 1 \
  --max-instances 1 \
  --concurrency 100 \
  --timeout 3600 \
  --cpu 1 \
  --memory 512Mi \
  --port 8080 \
  --session-affinity \
  --set-env-vars "DEBUG_LOGS=1,RELAYVIEW_REGION=${relayview_region}" \
  --quiet
gcloud run services describe "$service" --project "$project_id" --region "$region" --format='value(status.url)'
