#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════════════
# Crypto-Radar — Production Google Cloud Run Deployment Script
# ═══════════════════════════════════════════════════════════════════════

PROJECT_ID="${GCP_PROJECT_ID:-crypto-radar-prod}"
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-crypto-radar}"
VERSION="${1:-v2.10.0}"

echo "==============================================================="
echo " Deploying Crypto-Radar $VERSION to Cloud Run ($REGION)"
echo " GCP Project: $PROJECT_ID"
echo "==============================================================="

# 1. Ensure Artifact Registry repository exists
if ! gcloud artifacts repositories describe crypto-radar --location="$REGION" --project="$PROJECT_ID" &>/dev/null; then
  echo "[+] Creating Artifact Registry Docker repository..."
  gcloud artifacts repositories create crypto-radar \
    --repository-format=docker \
    --location="$REGION" \
    --project="$PROJECT_ID" \
    --description="Crypto-Radar container images"
fi

IMAGE_URI="$REGION-docker.pkg.dev/$PROJECT_ID/crypto-radar/service:$VERSION"

# 2. Build and push container image via Cloud Build
echo "[+] Building container image: $IMAGE_URI"
gcloud builds submit --tag "$IMAGE_URI" --project="$PROJECT_ID" .

# 3. Deploy to Cloud Run
echo "[+] Deploying Cloud Run service: $SERVICE_NAME"
gcloud run deploy "$SERVICE_NAME" \
  --image="$IMAGE_URI" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=2Gi \
  --cpu=2 \
  --min-instances=0 \
  --max-instances=10 \
  --concurrency=80 \
  --timeout=300 \
  --set-env-vars="NODE_ENV=production,RADAR_ENV=production,BIGQUERY_DATASET=crypto_radar,GCS_BUCKET=crypto-radar-models"

SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" --region="$REGION" --project="$PROJECT_ID" --format='value(status.url)')
echo "==============================================================="
echo " Deployment successful!"
echo " Service URL: $SERVICE_URL"
echo " Swagger Docs: $SERVICE_URL/docs"
echo "==============================================================="
