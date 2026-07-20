# Google Artifact Registry — Reference

> **Last updated:** 2026-07-19  
> **Source:** [Official GCP Documentation](https://cloud.google.com/artifact-registry/docs)  
> **Use case:** Docker image repository for Cloud Run deployments in the Crypto Radar project

---

## Table of Contents

1. [Overview](#overview)
2. [Pricing & Free Tier](#pricing--free-tier)
3. [Repository Setup](#repository-setup)
4. [Authentication](#authentication)
5. [Pushing & Pulling Images](#pushing--pulling-images)
6. [Cloud Build Integration](#cloud-build-integration)
7. [IAM Roles & Permissions](#iam-roles--permissions)
8. [Tagging Best Practices](#tagging-best-practices)
9. [Cleanup Policies](#cleanup-policies)
10. [Image Naming & Path Structure](#image-naming--path-structure)
11. [Common Workflows](#common-workflows)
12. [Sources](#sources)

---

## Overview

[Artifact Registry](https://cloud.google.com/artifact-registry/docs) is Google Cloud's universal package manager for build artifacts and dependencies. It supersedes the deprecated Container Registry (gcr.io).

**Supported artifact formats:**
- Docker container images (primary use for Crypto Radar)
- Helm charts
- Language packages: Go, Java (Maven), Node.js (npm), Python, Ruby
- OS packages: Debian, RPM

**Repository modes:**
- **Standard** — stores artifacts in the project (default, used by Crypto Radar)
- **Remote** — acts as a proxy/cache for an upstream registry (e.g., Docker Hub)
- **Virtual** — combines multiple upstream repositories into a single endpoint

### Crypto Radar Relevance

The Crypto Radar Docker image (~200 MB compressed) is stored in Artifact Registry and deployed to Cloud Run. At this size, a single image version fits well within the 500 MB free tier.

---

## Pricing & Free Tier

### Free Tier

| Tier | Limit | Cost |
|------|-------|------|
| Storage | 0 – 0.5 GB-month per billing account | **Free** |
| Data transfer within same GCP location | Unlimited | **Free** |
| Data transfer same continent (region ↔ multi-region) | Unlimited | **Free** |

> **Note:** The free tier applies across ALL projects under the same billing account, not per project.

### Paid Tier

| Item | Price |
|------|-------|
| Storage (above 0.5 GB-month) | $0.10/GB/month |
| Egress — US ↔ Canada (same continent) | $0.01/GB |
| Egress — Europe (same continent) | $0.02/GB |
| Egress — Asia (same continent) | $0.05/GB |
| Egress — Cross-continent (excluding Oceania) | $0.08/GB |
| Egress — Oceania to/from any region | $0.15/GB |
| Interconnect egress — North America | $0.02/GB |
| Interconnect egress — Europe | $0.02/GB |
| Interconnect egress — Asia | $0.042/GB |

### Cost-Saving Practices

1. **Co-locate repositories** in the same region as the runtime (e.g., `us-west1` for Cloud Run in `us-west1`)
2. **Use cleanup policies** to delete old/untagged images
3. **Tag with commit SHA** and only keep `latest` + recent N versions

---

## Repository Setup

### Create a Repository

```bash
# Syntax
gcloud artifacts repositories create REPOSITORY \
    --repository-format=docker \
    --location=REGION \
    --description="Description" \
    --project=PROJECT_ID

# Example for Crypto Radar
gcloud artifacts repositories create crypto-radar \
    --repository-format=docker \
    --location=us-west1 \
    --description="Crypto Radar Docker images" \
    --project=crypto-radar-457010
```

### List Repositories

```bash
gcloud artifacts repositories list --project=PROJECT_ID
```

### Get Repository Details

```bash
gcloud artifacts repositories describe REPOSITORY \
    --location=REGION \
    --project=PROJECT_ID
```

### Delete a Repository

```bash
gcloud artifacts repositories delete REPOSITORY \
    --location=REGION
```

> **Warning:** Deleting a repository removes all artifacts in it. Ensure images are backed up or migrated first.

---

## Authentication

### Docker Authentication (Primary Method)

Configure Docker to authenticate via gcloud credential helper:

```bash
# Single region
gcloud auth configure-docker us-west1-docker.pkg.dev

# All regions (run multiple times)
gcloud auth configure-docker us-west1-docker.pkg.dev
gcloud auth configure-docker us-central1-docker.pkg.dev
```

This updates `~/.docker/config.json` with the credential helper entry:
```json
{
  "credHelpers": {
    "us-west1-docker.pkg.dev": "gcloud",
    "us-central1-docker.pkg.dev": "gcloud"
  }
}
```

### Podman Authentication

Podman checks `~/.config/containers/auth.json` first, then falls back to `~/.docker/config.json`. Configure identically:

```bash
gcloud auth configure-docker us-west1-docker.pkg.dev
```

If Podman cannot find credentials, copy the `auths` section:

```bash
# Copy Docker config to Podman's location
cp ~/.docker/config.json ~/.config/containers/auth.json

# Or authenticate with an access token
gcloud auth print-access-token | \
    podman login -u oauth2accesstoken --password-stdin us-west1-docker.pkg.dev
```

### Verify Authentication

```bash
# Check the credential helper is configured
cat ~/.docker/config.json | grep -A2 "us-west1-docker.pkg.dev"

# Test by pulling a known image
docker pull us-west1-docker.pkg.dev/PROJECT_ID/crypto-radar/test:latest
```

---

## Pushing & Pulling Images

### Image Path Structure

```
LOCATION-docker.pkg.dev/PROJECT_ID/REPOSITORY/IMAGE:TAG
```

| Part | Example | Description |
|------|---------|-------------|
| `LOCATION` | `us-west1` | Regional or multi-regional location |
| `PROJECT_ID` | `crypto-radar-457010` | GCP project ID |
| `REPOSITORY` | `crypto-radar` | Repository name |
| `IMAGE` | `backend` | Image name |
| `TAG` | `v1.0.0` or `sha-abc1234` | Image tag (default: `latest`) |

### Tag a Local Image

```bash
docker tag SOURCE_IMAGE \
    us-west1-docker.pkg.dev/PROJECT_ID/REPOSITORY/IMAGE:TAG

# Example
docker tag crypto-radar:latest \
    us-west1-docker.pkg.dev/crypto-radar-457010/crypto-radar/api:latest

# Tag with commit SHA
docker tag crypto-radar:latest \
    us-west1-docker.pkg.dev/crypto-radar-457010/crypto-radar/api:sha-abc1234
```

### Push an Image

```bash
docker push us-west1-docker.pkg.dev/PROJECT_ID/REPOSITORY/IMAGE:TAG

# Example
docker push us-west1-docker.pkg.dev/crypto-radar-457010/crypto-radar/api:latest
docker push us-west1-docker.pkg.dev/crypto-radar-457010/crypto-radar/api:sha-abc1234
```

> **Important:** Artifact Registry requires **monolithic uploads** (not chunked). This is the default behavior for Docker.

### Pull an Image

```bash
docker pull us-west1-docker.pkg.dev/PROJECT_ID/REPOSITORY/IMAGE:TAG

# By tag
docker pull us-west1-docker.pkg.dev/crypto-radar-457010/crypto-radar/api:latest

# By digest (immutable reference)
docker pull us-west1-docker.pkg.dev/crypto-radar-457010/crypto-radar/api@sha256:85f...
```

### List Images in Repository

```bash
gcloud artifacts docker images list \
    us-west1-docker.pkg.dev/PROJECT_ID/REPOSITORY \
    --include-tags
```

Output:
```
IMAGE                                                              DIGEST        CREATE_TIME           UPDATE_TIME
us-west1-docker.pkg.dev/.../crypto-radar/api  sha256:85f...  2026-07-19T15:08:45  2026-07-19T15:08:45
us-west1-docker.pkg.dev/.../crypto-radar/api  sha256:238...  2026-07-19T17:23:53  2026-07-19T17:23:53
```

### Delete an Image

```bash
# Delete by tag
gcloud artifacts docker images delete \
    us-west1-docker.pkg.dev/PROJECT_ID/REPOSITORY/IMAGE:TAG \
    --delete-tags

# Delete by digest
gcloud artifacts docker images delete \
    us-west1-docker.pkg.dev/PROJECT_ID/REPOSITORY/IMAGE@sha256:DIGEST
```

---

## Cloud Build Integration

### Build Config (cloudbuild.yaml)

Cloud Build natively integrates with Artifact Registry. The build config pushes built images and optionally deploys to Cloud Run.

**Minimal build + push:**

```yaml
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - 'build'
      - '-t'
      - 'us-west1-docker.pkg.dev/$PROJECT_ID/crypto-radar/api:latest'
      - '-t'
      - 'us-west1-docker.pkg.dev/$PROJECT_ID/crypto-radar/api:$COMMIT_SHA'
      - '.'
images:
  - 'us-west1-docker.pkg.dev/$PROJECT_ID/crypto-radar/api:latest'
  - 'us-west1-docker.pkg.dev/$PROJECT_ID/crypto-radar/api:$COMMIT_SHA'
```

**Build + push + deploy to Cloud Run:**

```yaml
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - 'build'
      - '-t'
      - 'us-west1-docker.pkg.dev/$PROJECT_ID/crypto-radar/api:latest'
      - '-t'
      - 'us-west1-docker.pkg.dev/$PROJECT_ID/crypto-radar/api:$COMMIT_SHA'
      - '.'

  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args:
      - 'run'
      - 'deploy'
      - 'crypto-radar'
      - '--image'
      - 'us-west1-docker.pkg.dev/$PROJECT_ID/crypto-radar/api:$COMMIT_SHA'
      - '--region'
      - 'us-west1'
images:
  - 'us-west1-docker.pkg.dev/$PROJECT_ID/crypto-radar/api:latest'
  - 'us-west1-docker.pkg.dev/$PROJECT_ID/crypto-radar/api:$COMMIT_SHA'
```

### Cloud Build Substitutions

| Variable | Description |
|----------|-------------|
| `$PROJECT_ID` | Current GCP project ID |
| `$COMMIT_SHA` | Git commit SHA (from trigger) |
| `$BRANCH_NAME` | Git branch name |
| `$TAG_NAME` | Git tag name |
| `$SHORT_SHA` | First 7 characters of `$COMMIT_SHA` |

### Cloud Build Service Account Permissions

The Cloud Build service account (`PROJECT_NUMBER@cloudbuild.gserviceaccount.com`) needs Artifact Registry permissions (granted via the `roles/cloudbuild.builds.builder` role by default):

| Permission | Purpose |
|------------|---------|
| `artifactregistry.repositories.uploadArtifacts` | Push images to repositories |
| `artifactregistry.repositories.downloadArtifacts` | Pull images from repositories |
| `artifactregistry.dockerimages.get` | Get Docker image metadata |
| `artifactregistry.dockerimages.list` | List Docker images |
| `artifactregistry.tags.create` | Create image tags |
| `artifactregistry.tags.get` | Get image tags |
| `artifactregistry.tags.list` | List image tags |
| `artifactregistry.tags.update` | Update image tags |

**Additional permission needed for Cloud Run deployment:**
Add `roles/run.admin` and `roles/iam.serviceAccountUser` to the Cloud Build SA.

---

## IAM Roles & Permissions

### Predefined Roles

| Role | Description | Use Case |
|------|-------------|----------|
| `roles/artifactregistry.reader` | View and get artifacts, view repository metadata | CI/CD pull, read-only access |
| `roles/artifactregistry.writer` | Read and write artifacts | Cloud Build SA pushing images |
| `roles/artifactregistry.repoAdmin` | Read, write, and delete artifacts | Manual cleanup, manual pushes |
| `roles/artifactregistry.admin` | Full management — create/delete repos, artifacts | Infrastructure setup |
| `roles/artifactregistry.createOnPushWriter` | Read + write + auto-create gcr.io repos on push | Migration from Container Registry |

### Granting Roles

**Project-wide (all repositories in project):**

```bash
gcloud projects add-iam-policy-binding PROJECT_ID \
    --member=serviceAccount:SA_EMAIL \
    --role=roles/artifactregistry.writer
```

**Repository-specific:**

```bash
gcloud artifacts repositories add-iam-policy-binding REPOSITORY \
    --location=REGION \
    --member=serviceAccount:SA_EMAIL \
    --role=roles/artifactregistry.writer
```

### Minimal Permissions for CI/CD

For Cloud Build to push to Artifact Registry and deploy to Cloud Run:

```bash
# Grant Artifact Registry Writer
gcloud projects add-iam-policy-binding PROJECT_ID \
    --member=serviceAccount:PROJECT_NUMBER@cloudbuild.gserviceaccount.com \
    --role=roles/artifactregistry.writer

# Grant Cloud Run Admin
gcloud projects add-iam-policy-binding PROJECT_ID \
    --member=serviceAccount:PROJECT_NUMBER@cloudbuild.gserviceaccount.com \
    --role=roles/run.admin

# Grant Service Account User (to act as Cloud Run runtime SA)
gcloud iam service-accounts add-iam-policy-binding \
    PROJECT_NUMBER-compute@developer.gserviceaccount.com \
    --member=serviceAccount:PROJECT_NUMBER@cloudbuild.gserviceaccount.com \
    --role=roles/iam.serviceAccountUser
```

---

## Tagging Best Practices

### Recommended Tag Strategy

Use **two tags** per image push to enable both human-readable references and immutable rollback targets:

```bash
# 1. `latest` — mutable pointer, always the most recent deployment
# 2. `sha-COMMIT_SHA` — immutable, enables rollback to any exact build

docker tag crypto-radar:latest us-west1-docker.pkg.dev/PROJECT_ID/crypto-radar/api:latest
docker tag crypto-radar:latest us-west1-docker.pkg.dev/PROJECT_ID/crypto-radar/api:sha-abc1234
docker push us-west1-docker.pkg.dev/PROJECT_ID/crypto-radar/api:latest
docker push us-west1-docker.pkg.dev/PROJECT_ID/crypto-radar/api:sha-abc1234
```

### Cloud Run Deployment

Cloud Run can deploy by tag or digest:

```bash
# Deploy by commit SHA tag (rollback-safe)
gcloud run deploy crypto-radar \
    --image=us-west1-docker.pkg.dev/PROJECT_ID/crypto-radar/api:sha-abc1234 \
    --region=us-west1

# Deploy by digest
gcloud run deploy crypto-radar \
    --image=us-west1-docker.pkg.dev/PROJECT_ID/crypto-radar/api@sha256:DIGEST \
    --region=us-west1
```

### Tag Convention for Crypto Radar

| Tag | Purpose | Mutability |
|-----|---------|------------|
| `latest` | Current deployment | Mutable |
| `sha-<7-char-commit>` | Specific build (rollback target) | Immutable |
| `v<major>.<minor>.<patch>` | Release version (optional) | Usually immutable |

---

## Cleanup Policies

Cleanup policies automatically delete old images to save storage costs. Policies are defined in JSON and can be applied via Console or gcloud.

### Policy Types

| Policy | Action | Description |
|--------|--------|-------------|
| **Delete** | Delete artifacts that match conditions | Free up storage |
| **Keep (conditional)** | Retain artifacts matching conditions (overrides delete) | Protect specific versions |
| **Keep (most recent N)** | Retain the N most recent versions | Keep deployment history |

### Apply a Cleanup Policy

**Via gcloud (JSON file):**

Create a policy file `cleanup-policy.json`:

```json
{
  "name": "delete-untagged-older-than-30d",
  "action": {
    "type": "Delete"
  },
  "condition": {
    "tagState": "untagged",
    "olderThan": "720h"
  }
}
```

Apply it:

```bash
gcloud artifacts repositories set-cleanup-policies REPOSITORY \
    --location=REGION \
    --policy=cleanup-policy.json
```

### Recommended Cleanup Policy for Crypto Radar

Keep 10 most recent versions of tagged images, delete untagged images older than 30 days:

```json
[
  {
    "name": "keep-10-recent",
    "action": {
      "type": "Keep"
    },
    "mostRecentVersions": {
      "keepNumber": 10
    }
  },
  {
    "name": "delete-untagged-older-30d",
    "action": {
      "type": "Delete"
    },
    "condition": {
      "tagState": "untagged",
      "olderThan": "720h"
    }
  }
]
```

### Dry Run Cleanup Policies

Before applying a delete policy, test it in dry-run mode:

```bash
# In Console: Select "Dry run" in the Cleanup policies section
# Via gcloud: --dry-run flag (not all versions support it)

gcloud artifacts repositories set-cleanup-policies REPOSITORY \
    --location=REGION \
    --policy=cleanup-policy.json \
    --dry-run
```

### View Cleanup Policies

```bash
gcloud artifacts repositories describe REPOSITORY \
    --location=REGION \
    --format="value(cleanupPolicies)"
```

### Remove Cleanup Policies

```bash
gcloud artifacts repositories remove-cleanup-policies REPOSITORY \
    --location=REGION \
    --policy-names=delete-untagged-older-than-30d
```

---

## Image Naming & Path Structure

### Repository URL Format

```
LOCATION-docker.pkg.dev/PROJECT_ID/REPOSITORY/IMAGE:TAG
```

### Example Paths for Crypto Radar

| Purpose | Full Path |
|---------|-----------|
| Latest API image | `us-west1-docker.pkg.dev/crypto-radar-457010/crypto-radar/api:latest` |
| Commit-specific API | `us-west1-docker.pkg.dev/crypto-radar-457010/crypto-radar/api:sha-abc1234` |
| Latest worker image | `us-west1-docker.pkg.dev/crypto-radar-457010/crypto-radar/worker:latest` |

### Repository Organization Patterns

**Option A — Single repository, multiple images** (recommended for small projects):

```
crypto-radar/          # Single repository
  api:latest           # One image per component
  api:sha-abc1234
  worker:latest
  worker:sha-def5678
```

**Option B — Multiple repositories** (better isolation for larger projects):

```
crypto-radar-api/      # Repository per component
  api:latest
  api:sha-abc1234

crypto-radar-worker/   # Separate repository
  worker:latest
  worker:sha-def5678
```

For Crypto Radar's scale, Option A (single repository) is sufficient and simpler.

---

## Common Workflows

### Local Development: Build, Tag, Push

```bash
# 1. Build the image
docker build -t crypto-radar:latest .

# 2. Authenticate Docker to Artifact Registry
gcloud auth configure-docker us-west1-docker.pkg.dev

# 3. Tag for Artifact Registry
docker tag crypto-radar:latest \
    us-west1-docker.pkg.dev/crypto-radar-457010/crypto-radar/api:latest

docker tag crypto-radar:latest \
    us-west1-docker.pkg.dev/crypto-radar-457010/crypto-radar/api:sha-$(git rev-parse --short HEAD)

# 4. Push both tags
docker push us-west1-docker.pkg.dev/crypto-radar-457010/crypto-radar/api:latest
docker push us-west1-docker.pkg.dev/crypto-radar-457010/crypto-radar/api:sha-$(git rev-parse --short HEAD)

# 5. Deploy to Cloud Run
gcloud run deploy crypto-radar \
    --image=us-west1-docker.pkg.dev/crypto-radar-457010/crypto-radar/api:sha-$(git rev-parse --short HEAD) \
    --region=us-west1
```

### CI/CD with Cloud Build (Push-triggered)

Trigger on push to `main` branch:

```yaml
# cloudbuild.yaml
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - 'build'
      - '-t'
      - 'us-west1-docker.pkg.dev/$PROJECT_ID/crypto-radar/api:latest'
      - '-t'
      - 'us-west1-docker.pkg.dev/$PROJECT_ID/crypto-radar/api:$COMMIT_SHA'
      - '.'

  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args:
      - 'run'
      - 'deploy'
      - 'crypto-radar'
      - '--image=us-west1-docker.pkg.dev/$PROJECT_ID/crypto-radar/api:$COMMIT_SHA'
      - '--region=us-west1'

images:
  - 'us-west1-docker.pkg.dev/$PROJECT_ID/crypto-radar/api:latest'
  - 'us-west1-docker.pkg.dev/$PROJECT_ID/crypto-radar/api:$COMMIT_SHA'
```

### Rollback to Previous Version

```bash
# List available images
gcloud artifacts docker images list \
    us-west1-docker.pkg.dev/crypto-radar-457010/crypto-radar/api \
    --include-tags

# Deploy a specific previous commit
gcloud run deploy crypto-radar \
    --image=us-west1-docker.pkg.dev/crypto-radar-457010/crypto-radar/api:sha-PREVIOUS_SHA \
    --region=us-west1
```

---

## Sources

- [Artifact Registry Documentation](https://cloud.google.com/artifact-registry/docs)
- [Artifact Registry Pricing](https://cloud.google.com/artifact-registry/pricing)
- [Quickstart: Store Docker Images in Artifact Registry](https://cloud.google.com/artifact-registry/docs/docker/store-docker-container-images)
- [Push and Pull Images](https://cloud.google.com/artifact-registry/docs/docker/pushing-and-pulling)
- [Access Control with IAM](https://cloud.google.com/artifact-registry/docs/access-control)
- [Cleanup Policies](https://cloud.google.com/artifact-registry/docs/repositories/cleanup-policy)
- [Cloud Build Service Account](https://cloud.google.com/build/docs/cloud-build-service-account)
- [Build Container Images](https://cloud.google.com/build/docs/building/build-containers-images)
