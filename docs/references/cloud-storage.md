# Google Cloud Storage & gcsfuse Reference

> **Sources:** [Google Cloud Storage Docs](https://cloud.google.com/storage/docs),
> [Cloud Storage FUSE Docs](https://cloud.google.com/storage/docs/cloud-storage-fuse/overview),
> [Cloud Storage Pricing](https://cloud.google.com/storage/pricing),
> [GCP Free Tier](https://cloud.google.com/free/docs/gcp-free-tier)

---

## Table of Contents

1. [Overview](#overview)
2. [Buckets](#buckets)
   - [What is a Bucket](#what-is-a-bucket)
   - [Bucket Naming Requirements](#bucket-naming-requirements)
   - [Bucket Locations](#bucket-locations)
   - [Creating a Bucket (gcloud)](#creating-a-bucket-gcloud)
   - [Creating a Bucket (Console)](#creating-a-bucket-console)
   - [Creating a Bucket (Terraform)](#creating-a-bucket-terraform)
   - [Creating a Bucket (JSON API)](#creating-a-bucket-json-api)
3. [Uniform Bucket-Level Access](#uniform-bucket-level-access)
4. [Object Hierarchy & Namespace](#object-hierarchy--namespace)
5. [Storage Classes](#storage-classes)
   - [Standard Storage](#standard-storage)
   - [Nearline Storage](#nearline-storage)
   - [Coldline Storage](#coldline-storage)
   - [Archive Storage](#archive-storage)
   - [Rapid Storage](#rapid-storage)
   - [Autoclass](#autoclass)
   - [Storage Class Summary](#storage-class-summary)
6. [Pricing](#pricing)
   - [Data Storage Costs](#data-storage-costs)
   - [Data Operation Costs](#data-operation-costs)
   - [Network Egress Costs](#network-egress-costs)
   - [Free Tier](#free-tier)
   - [Free Tier Focus: Staying Within Free Tier for Crypto Radar](#free-tier-focus-staying-within-free-tier-for-crypto-radar)
7. [Object Lifecycle Management](#object-lifecycle-management)
   - [Actions](#actions)
   - [Conditions](#conditions)
   - [Rule Evaluation](#rule-evaluation)
   - [Configuration Examples](#configuration-examples)
   - [Applying via gcloud](#applying-via-gcloud)
8. [IAM & Access Control](#iam--access-control)
   - [Predefined Roles](#predefined-roles)
   - [Minimal Permissions for Cloud Run SA](#minimal-permissions-for-cloud-run-sa)
   - [Essential IAM Commands](#essential-iam-commands)
   - [IAM Conditions](#iam-conditions)
   - [Access Control Best Practices](#access-control-best-practices)
9. [Consistency Model](#consistency-model)
10. [Performance Tuning](#performance-tuning)
    - [Request Rate Guidelines](#request-rate-guidelines)
    - [Latency Characteristics](#latency-characteristics)
    - [File Cache Mode](#file-cache-mode)
    - [Parallel Uploads & Downloads](#parallel-uploads--downloads)
    - [Performance Summary](#performance-summary)
11. [Cloud Storage FUSE (gcsfuse)](#cloud-storage-fuse-gcsfuse)
    - [Overview](#gcsfuse-overview)
    - [Installation](#gcsfuse-installation)
    - [Authentication](#gcsfuse-authentication)
    - [Basic Mounting](#gcsfuse-basic-mounting)
    - [Mounting Options](#gcsfuse-mounting-options)
    - [Caching](#gcsfuse-caching)
    - [Configuration File](#gcsfuse-configuration-file)
    - [Performance Characteristics](#gcsfuse-performance-characteristics)
    - [Known Limitations](#gcsfuse-known-limitations)
12. [gcsfuse in Cloud Run](#gcsfuse-in-cloud-run)
    - [Volume Mount Setup](#cloud-run-volume-mount-setup)
    - [Deployment Commands](#cloud-run-deployment-commands)
    - [Important Notes](#cloud-run-important-notes)
    - [Configuring Mount Options in Cloud Run](#cloud-run-mount-options)
13. [gcloud CLI Commands Reference](#gcloud-cli-commands-reference)
    - [Bucket Operations](#gcloud-bucket-operations)
    - [Object Operations](#gcloud-object-operations)
    - [IAM Operations](#gcloud-iam-operations)
    - [Lifecycle Operations](#gcloud-lifecycle-operations)
    - [Monitoring & Logging](#gcloud-monitoring-logging)
14. [Best Practices for Crypto Ticker Data](#best-practices-for-crypto-ticker-data)
    - [Data Model](#crypto-data-model)
    - [Recommendations](#crypto-recommendations)
    - [Sample Lifecycle for Ticker Data](#crypto-sample-lifecycle)
    - [Performance Considerations](#crypto-performance-considerations)
    - [Sample Python Script](#crypto-sample-python-script)
15. [References](#references)

---

## Overview

Google Cloud Storage (GCS) is a scalable, fully-managed object storage service for unstructured data.
Key characteristics:

- **Unlimited storage** with per-object maximum of 5 TiB (before composite objects)
- **99.999999999%** (11 9's) annual durability
- **Low latency** with no offline data retrieval (even for Archive class)
- **Strong global consistency** for read-after-write, read-after-delete, and listing operations
- **Uniform experience** across APIs (JSON, XML, gRPC), tools (gcloud, gsutil), and client libraries
- **Storage classes** optimize cost based on access frequency
- **Object Lifecycle Management** for automatic transitions and deletions

> Source: <https://cloud.google.com/storage/docs/introduction>

---

## Buckets

### What is a Bucket

A bucket is the fundamental container in Cloud Storage. All data is stored as objects that reside in
buckets. Key properties:

| Property | Description |
| ---------- | ------------- |
| **Globally unique name** | Across all of Google Cloud, cannot be changed after creation |
| **Location type** | Region, dual-region, or multi-region |
| **Default storage class** | Objects inherit this unless overridden |
| **Soft delete** | Enabled by default (7-day retention); protects against accidental deletion |
| **IAM policy** | Controls access at bucket level (when uniform bucket-level access is enabled) |

### Bucket Naming Requirements

Bucket names must:

- Be **globally unique** across all Google Cloud projects
- Contain only lowercase letters, numbers, hyphens (`-`), underscores (`_`), and dots (`.`)
- Start and end with a letter or number
- Contain 3–63 characters (or 1–63 for IP address-style names)
- Cannot be formatted as an IP address (e.g., `192.168.1.1`)
- Cannot begin with the `goog` prefix
- Cannot contain `google` (or misspellings thereof)

### Bucket Locations

| Location Type | Description | Examples | SLA |
| --------------- | ------------- | ---------- | ----- |
| **Region** | Data stored in a single geographic region | `us-central1` (Iowa), `europe-west1` (Belgium) | 99.9% |
| **Dual-region** | Data stored across two regions within same continent | `nam4` (US), `eur4` (Europe) | 99.95% |
| **Multi-region** | Data stored across multiple regions in a large geographic area | `us` (United States), `eu` (Europe) | 99.95% |

**Choosing a location:**

- **Region** — lowest latency for co-located compute, lowest cost, best for crypto ticker data near Cloud Run
- **Dual-region** — higher availability with geo-redundancy
- **Multi-region** — global access patterns (website serving, mobile apps)
- **Zonal** (with Rapid Bucket) — highest performance, data in same zone as compute

### Creating a Bucket (gcloud)

```bash
# Create with uniform bucket-level access (recommended)
gcloud storage buckets create gs://my-bucket \
    --location=us-central1 \
    --default-storage-class=STANDARD \
    --uniform-bucket-level-access

# Create with Autoclass enabled
gcloud storage buckets create gs://my-bucket \
    --location=us-central1 \
    --uniform-bucket-level-access \
    --autoclass

# Create with soft delete disabled (for ephemeral/temporary data)
gcloud storage buckets create gs://my-bucket \
    --location=us-central1 \
    --no-soft-delete

# Full featured creation
gcloud storage buckets create gs://BUCKET_NAME \
    --project=PROJECT_ID \
    --default-storage-class=STORAGE_CLASS \
    --location=BUCKET_LOCATION \
    --uniform-bucket-level-access \
    --soft-delete-duration=RETENTION_DURATION \
    --public-access-prevention
```

**Required IAM role:** `roles/storage.admin` on the project.
**Key permissions:** `storage.buckets.create`, `storage.buckets.list` (for Console).

> Source: <https://cloud.google.com/storage/docs/creating-buckets>

### Creating a Bucket (Console)

1. Go to **Cloud Storage > Buckets** in Google Cloud Console
2. Click **Create**
3. Enter a globally unique name
4. Choose location type and location
5. Choose default storage class (or Autoclass)
6. Choose access control method (uniform recommended)
7. Configure data protection settings (soft delete, encryption)
8. Click **Create**

### Creating a Bucket (Terraform)

```hcl
resource "google_storage_bucket" "ticker_data" {
  name          = "crypto-radar-ticker-data"
  location      = "US-CENTRAL1"
  storage_class = "STANDARD"

  uniform_bucket_level_access = true

  lifecycle_rule {
    action {
      type = "SetStorageClass"
      storage_class = "NEARLINE"
    }
    condition {
      age = 30
      matches_prefix = ["raw/ticker-"]
    }
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      age = 365
    }
  }

  soft_delete_policy {
    retention_duration_seconds = 604800  # 7 days
  }
}
```

### Creating a Bucket (JSON API)

```bash
# Create JSON configuration
cat > bucket-config.json <<EOF
{
  "name": "BUCKET_NAME",
  "location": "BUCKET_LOCATION",
  "storageClass": "STANDARD",
  "iamConfiguration": {
    "uniformBucketLevelAccess": {
      "enabled": true
    }
  }
}
EOF

# Call the JSON API
curl -X POST --data-binary @bucket-config.json \
    -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    -H "Content-Type: application/json" \
    "https://storage.googleapis.com/storage/v1/b?project=PROJECT_ID"
```

---

## Uniform Bucket-Level Access

### What It Is

Uniform bucket-level access disables legacy ACLs (Access Control Lists) on a bucket so that access
is granted exclusively through IAM. This is the **recommended** access control model for
all new buckets.

### Key Points

- ACLs are disabled — all access is governed by IAM
- Required for: hierarchical namespace, managed folders, IAM Conditions on buckets
- Cannot be disabled after **90 consecutive days** of being enabled
- Prevents unintended data exposure from misconfigured object ACLs
- Object-level fine-grained access requires separate buckets when needed

### Enabling

```bash
# During bucket creation (recommended)
gcloud storage buckets create gs://my-bucket --uniform-bucket-level-access

# On an existing bucket
gcloud storage buckets update gs://my-bucket --uniform-bucket-level-access
```

### Migration Considerations

Before enabling on an existing bucket:

1. **Check ACL usage** with Cloud Monitoring metric: `storage.googleapis.com/authz/acl_operations_count`
2. **Assign IAM equivalents** to any users relying on object ACLs:

| Object ACL Permission | Equivalent IAM Role |
| ------------------------ | --------------------- |
| READER | `roles/storage.legacyObjectReader` |
| OWNER | `roles/storage.legacyObjectOwner` |

1. **Review default object ACL** and assign equivalent IAM bucket-level roles
2. **Migrate data** with heterogeneous permissions into separate buckets

> Source: <https://cloud.google.com/storage/docs/uniform-bucket-level-access>

---

## Object Hierarchy & Namespace

### Flat Namespace (Default)

Cloud Storage has a **flat namespace** — what appears as directories are just object name prefixes:

```
gs://my-bucket/data/2024/01/ticker-BTCUSD.csv
```

The object name is literally `data/2024/01/ticker-BTCUSD.csv`. The `/` characters are part of the
object key, not directory separators. Simulated folders are inferred by prefix matching.

### Hierarchical Namespace

Buckets with hierarchical namespace enabled provide:

- Actual directory objects (folders)
- Atomic rename/move operations (no copy+delete)
- Better performance for HDFS-like workloads
- Native gcsfuse directory support

**Must be enabled at bucket creation** — cannot be changed later.

```bash
gcloud storage buckets create gs://my-bucket \
    --location=us-central1 \
    --enable-hierarchical-namespace
```

| Aspect | Flat Namespace | Hierarchical Namespace |
| -------- | --------------- | ---------------------- |
| Directory listing | Prefix scan | Native directory listing |
| Rename | Copy + delete | Atomic |
| Performance at scale | Degrades with millions of objects under same prefix | Maintains performance |
| gcsfuse | Requires `--implicit-dirs` | Works natively |

---

## Storage Classes

### Standard Storage

- **Best for:** Frequently accessed ("hot") data, short-lived data
- **Availability SLA:** 99.95% multi-region, 99.9% region
- **Typical monthly:** >99.99% multi-region, 99.99% region
- **Minimum duration:** None
- **Retrieval fees:** None
- **Price:** $0.020/GB/month

### Nearline Storage

- **Best for:** Data accessed ~1×/month or less (backup, long-tail media)
- **Availability SLA:** 99.9% multi-region, 99.0% region
- **Minimum duration:** 30 days (early deletion penalty applies)
- **Retrieval fees:** Yes (per GB read)
- **Price:** $0.010/GB/month

### Coldline Storage

- **Best for:** Data accessed ~1×/quarter
- **Availability SLA:** 99.9% multi-region, 99.0% region
- **Minimum duration:** 90 days
- **Retrieval fees:** Yes
- **Price:** $0.004/GB/month

### Archive Storage

- **Best for:** Regulatory archives, cold data, disaster recovery
- **Minimum duration:** 365 days
- **Retrieval fees:** Yes (highest)
- **Lowest at-rest storage cost:** $0.0012/GB/month
- Data is still available in milliseconds (not hours or days)

### Rapid Storage

- **Best for:** I/O-intensive AI/ML workloads, high-throughput data pipelines
- **Only available with zonal Rapid Buckets**
- **Minimum duration:** None
- **Retrieval fees:** None
- **Price:** $0.090/GB/month (highest)
- **Availability SLA:** 99.9% in zones

### Autoclass

Automatically transitions objects between storage classes based on access patterns:

- Moves unused objects Standard → Nearline → Coldline
- Promotes accessed Coldline/Nearline objects back to Standard
- Recommended for unpredictable access patterns
- Cannot coexist with manual `SetStorageClass` lifecycle rules

```bash
# Enable Autoclass
gcloud storage buckets update gs://my-bucket --autoclass

# Disable Autoclass
gcloud storage buckets update gs://my-bucket --no-autoclass
```

### Storage Class Summary

| Class | API Name | Min Duration | Retrieval Fee | Price/GB/mo | Use Case |
| ------- | ---------- | ------------- | --------------- | ------------- | ---------- |
| **Rapid** | `RAPID` | None | None | $0.090 | I/O-intensive, AI/ML, zonal |
| **Standard** | `STANDARD` | None | None | $0.020 | Hot data, frequent access |
| **Nearline** | `NEARLINE` | 30 days | Yes | $0.010 | Monthly access |
| **Coldline** | `COLDLINE` | 90 days | Yes | $0.004 | Quarterly access |
| **Archive** | `ARCHIVE` | 365 days | Yes | $0.0012 | Yearly/regulatory |

> Source: <https://cloud.google.com/storage/docs/storage-classes>

---

## Pricing

### Data Storage Costs

Prices per GB per month (us-central1 region, Standard tier):

| Class | Price/GB/month |
| ------- | ---------------- |
| Standard | **$0.020** |
| Nearline | **$0.010** |
| Coldline | **$0.004** |
| Archive | **$0.0012** |
| Rapid | **$0.090** (zonal) |

### Data Operation Costs

| Operation Type | Standard | Nearline | Coldline | Archive |
| --------------- | ---------- | ---------- | ---------- | --------- |
| Class A (writes, lists) | $0.05/10k ops | $0.10/10k ops | $0.10/10k ops | $0.50/10k ops |
| Class B (reads) | $0.004/10k ops | $0.01/10k ops | $0.01/10k ops | $0.05/10k ops |
| Free ops (per month) | 50k Class A + 50k Class B | — | — | — |

**Class A operations:** `storage.objects.create`, `storage.objects.list`, `storage.buckets.list`,
`storage.objects.compose`, `storage.buckets.getIamPolicy`, `storage.buckets.setIamPolicy`.

**Class B operations:** `storage.objects.get`, `storage.buckets.get`, `storage.objects.getIamPolicy`.

### Network Egress Costs

| Source | Destination | Cost |
| -------- | ------------- | ------ |
| GCS → Internet | Worldwide | $0.12/GB (first 1 TB/month) |
| GCS → Internet | Worldwide | $0.11/GB (next 9 TB) |
| GCS → GCP same region | Same region | **$0.00/GB (free)** |
| GCS → GCP different region | Different region | ~$0.01–$0.12/GB |
| GCS → Asia/Pacific/Australia | Internet | $0.14–$0.19/GB |

### Minimum Storage Duration Penalties

If an object is deleted or overwritten before its minimum storage duration, you're charged for the
remainder:

- **Nearline:** 30 days
- **Coldline:** 90 days
- **Archive:** 365 days

### Free Tier

Google Cloud Free Tier provides **always-free** Cloud Storage usage:

| Free Tier Item | Limit |
| ---------------- | ------- |
| **Standard Storage** | **5 GB** per month per account |
| Class A operations | **50,000** per month |
| Class B operations | **50,000** per month |
| Egress to GCP services in same region | Free |
| **Regions covered:** | us-central1, us-east1, us-west1 |

**Always-free** means this never expires — even after the 90-day Free Trial ends, as long as you
stay within limits.

> Source: <https://cloud.google.com/free/docs/gcp-free-tier>

### Free Tier Focus: Staying Within Free Tier for Crypto Radar

For a crypto ticker data pipeline, the free tier covers a meaningful amount of data:

**Storage budget: 5 GB**

- A CSV ticker row is ~100 bytes
- With 15-second intervals across 100 pairs: ~57 MB/day, ~1.7 GB/month
- With 1-minute intervals across 20 pairs: ~3 MB/day, ~100 MB/month
- 5 GB = ~50 million ticker rows

**Operation budget: 50k Class A + 50k Class B per month**

- Each file upload = 1 Class A operation
- 50k uploads = ~1,600/day = ~1 per minute
- Using batch files (write 1 file/hour instead of 1/tick) keeps this well within limits
- List operations also count as Class A — avoid frequent `ls` in automated scripts

**Strategies to stay within free tier:**

1. **Batch writes** — accumulate 5-15 minutes of tickers into one file, not one file per tick
2. **Use gcsfuse with caching** — stat caching and file caching reduce API operations
3. **Compress archives** — gzip historical data to stay under 5 GB for longer
4. **Set lifecycle rules** — auto-delete data older than 90-365 days
5. **Monitor usage** with `gcloud storage buckets describe` or Cloud Monitoring
6. **Same region compute** — Cloud Run in `us-central1` accessing GCS in `us-central1` = $0 egress
7. **Limit ticker pairs** — fewer pairs × wider intervals = less data
8. **Use Nearline/Coldline transitions** — lifecycle moves reduce standard storage costs
9. **Avoid unnecessary listings** — each `gsutil ls` or `gcloud storage objects list` is a Class A op

---

## Object Lifecycle Management

### Overview

Lifecycle rules define automatic actions on objects when conditions are met. Rules are set on
buckets and apply to current and future objects. Changes to lifecycle configuration can take
**up to 24 hours** to take effect.

> Source: <https://cloud.google.com/storage/docs/lifecycle>

### Actions

| Action | Description |
| -------- | ------------- |
| **`Delete`** | Deletes the object (soft-deleted by default unless soft delete is disabled) |
| **`SetStorageClass`** | Changes the object's storage class |
| **`AbortIncompleteMultipartUpload`** | Aborts stale multipart uploads and deletes parts |

### Conditions

| Condition | Description |
| ----------- | ------------- |
| `age` | Age in days since object creation (applied at midnight UTC on the day the condition is met) |
| `createdBefore` | Created before midnight of specified date (YYYY-MM-DD) |
| `customTimeBefore` | Custom-Time metadata before specified date |
| `daysSinceCustomTime` | Days since Custom-Time metadata was set |
| `daysSinceNoncurrentTime` | Days since object became noncurrent (versioning) |
| `isLive` | `true` for live objects, `false` for noncurrent versions |
| `matchesStorageClass` | Matches specified storage class(es) |
| `matchesPrefix` | Object name starts with specified prefix(es) |
| `matchesSuffix` | Object name ends with specified suffix(es) |
| `noncurrentTimeBefore` | Noncurrent since before specified date |
| `numNewerVersions` | At least N newer versions exist (versioning) |

### Rule Evaluation

- An object must match **all** conditions in a rule for the action to trigger
- If multiple rules match simultaneously:
  1. **`Delete`** takes precedence over **`SetStorageClass`**
  2. Multiple `SetStorageClass` rules → the **lowest-cost** storage class wins
- All conditions are optional, but **at least one condition** is required per rule

### Configuration Examples

**Delete objects older than 365 days:**

```json
{
  "lifecycle": {
    "rule": [{
      "action": {"type": "Delete"},
      "condition": {"age": 365}
    }]
  }
}
```

**Transition to Coldline after 90 days, Archive after 365, delete after 730:**

```json
{
  "lifecycle": {
    "rule": [
      {
        "action": {"type": "SetStorageClass", "storageClass": "COLDLINE"},
        "condition": {"age": 90}
      },
      {
        "action": {"type": "SetStorageClass", "storageClass": "ARCHIVE"},
        "condition": {"age": 365}
      },
      {
        "action": {"type": "Delete"},
        "condition": {"age": 730}
      }
    ]
  }
}
```

**Prefix-matching lifecycle (delete old ticker data after 90 days):**

```json
{
  "lifecycle": {
    "rule": [{
      "action": {"type": "Delete"},
      "condition": {
        "age": 90,
        "matchesPrefix": ["raw/ticker-"]
      }
    }]
  }
}
```

**Abort incomplete multipart uploads after 7 days:**

```json
{
  "lifecycle": {
    "rule": [{
      "action": {"type": "AbortIncompleteMultipartUpload"},
      "condition": {"age": 7}
    }]
  }
}
```

### Applying via gcloud

```bash
# Apply lifecycle config from JSON file
gcloud storage buckets update gs://my-bucket --lifecycle-file=lifecycle.json

# View lifecycle config
gcloud storage buckets describe gs://my-bucket --format="get(lifecycle)"

# Using gsutil (legacy — supports more advanced configs)
gsutil lifecycle set lifecycle.json gs://my-bucket
gsutil lifecycle get gs://my-bucket
```

### Execution Notes

- Lifecycle actions are performed **asynchronously** — there can be a lag between condition
  satisfaction and action execution
- `SetStorageClass` does NOT rewrite the object (cheaper than manual class change)
- Early deletion fees still apply for objects moved by lifecycle before their minimum duration
- Storage costs are waived for objects that:
  - Are in a bucket with soft delete disabled
  - Match a Delete rule with only `age` (or `age` + `matchesStorageClass`) condition
  - Have no object holds

---

## IAM & Access Control

### Predefined Roles

| Role | Name | Permissions | Use Case |
| ------ | ------ | ------------- | ---------- |
| **Storage Admin** | `roles/storage.admin` | Full control of all buckets and objects | Administrators |
| **Storage Object Admin** | `roles/storage.objectAdmin` | Full object CRUD (`create`, `get`, `delete`, `update`, `list`) | Application SAs |
| **Storage Object Viewer** | `roles/storage.objectViewer` | Read objects and list objects | Read-only access |
| **Storage Object Creator** | `roles/storage.objectCreator` | Create objects only (cannot read or list) | Upload-only SAs |
| **Storage Legacy Object Reader** | `roles/storage.legacyObjectReader` | Read objects (legacy ACL-based) | Migration only |
| **Storage Legacy Object Owner** | `roles/storage.legacyObjectOwner` | Full object control (legacy ACL-based) | Migration only |
| **Storage HMAC Key Admin** | `roles/storage.hmacKeyAdmin` | Manage HMAC keys | Key management |

> Source: <https://cloud.google.com/storage/docs/access-control/iam-roles>

### Minimal Permissions for Cloud Run SA

For a Cloud Run service that reads and writes crypto ticker data, use the **principle of
least privilege** — grant at bucket level, not project level:

**Read + Write ticker data:**

```bash
gcloud storage buckets add-iam-policy-binding gs://my-ticker-bucket \
    --member=serviceAccount:cloud-run-sa@project.iam.gserviceaccount.com \
    --role=roles/storage.objectAdmin
```

**Read-only (for serving/querying):**

```bash
gcloud storage buckets add-iam-policy-binding gs://my-ticker-bucket \
    --member=serviceAccount:cloud-run-sa@project.iam.gserviceaccount.com \
    --role=roles/storage.objectViewer
```

**Minimal custom role (write only, no delete):**

```bash
gcloud iam roles create storage.tickerWriter \
    --project=PROJECT_ID \
    --title="Ticker Data Writer" \
    --permissions=storage.objects.create,storage.objects.get
```

### Essential IAM Commands

```bash
# Grant role at bucket level (preferred)
gcloud storage buckets add-iam-policy-binding gs://my-bucket \
    --member=serviceAccount:sa@project.iam.gserviceaccount.com \
    --role=roles/storage.objectAdmin

# Grant role at project level (broader — use with caution)
gcloud projects add-iam-policy-binding my-project \
    --member=serviceAccount:sa@project.iam.gserviceaccount.com \
    --role=roles/storage.objectViewer

# View IAM policy
gcloud storage buckets get-iam-policy gs://my-bucket

# Remove IAM binding
gcloud storage buckets remove-iam-policy-binding gs://my-bucket \
    --member=serviceAccount:sa@project.iam.gserviceaccount.com \
    --role=roles/storage.objectViewer
```

### IAM Conditions

IAM Conditions allow fine-grained, attribute-based access control. Requires uniform
bucket-level access:

```bash
# Condition: access only objects with a specific prefix
gcloud storage buckets add-iam-policy-binding gs://my-bucket \
    --member=serviceAccount:sa@project.iam.gserviceaccount.com \
    --role=roles/storage.objectViewer \
    --condition="expression=resource.name.startsWith('projects/_/buckets/my-bucket/objects/raw/'),title=RestrictToRawPrefix"
```

### Access Control Best Practices

1. **Always use uniform bucket-level access** — disable ACLs on every bucket
2. **Grant at bucket level**, not project level (principle of least privilege)
3. **Use dedicated service accounts** per application, not user accounts
4. **Employ IAM Conditions** for prefix-level access when data sensitivity varies
5. **Audit regularly** with `gcloud storage buckets get-iam-policy gs://my-bucket`
6. **Enable public access prevention** unless serving public content
7. **Rotate HMAC keys** regularly if used for programmatic access

---

## Consistency Model

### Strongly Consistent Operations

As of 2020, Cloud Storage provides **strong global consistency** for all core operations:

| Operation | Guarantee |
| ----------- | ----------- |
| Object read-after-write | Immediate — no 404 after successful write |
| Object read-after-delete | Immediate — 404 immediately after deletion |
| Object read-after-metadata-update | Immediate — no stale metadata |
| Bucket read-after-create | Immediate |
| Object listing | New objects appear immediately |
| Bucket listing | New buckets appear immediately |

### Eventually Consistent Operations

| Operation | Propagation Delay |
| ----------- | ------------------ |
| IAM policy changes (grant/revoke access) | ~1 minute (up to several minutes) |
| Bucket recreation after deletion | Several minutes |
| HMAC key state changes | Up to 3 minutes |

### Caching & Consistency

- Public objects with `Cache-Control` headers can serve stale content until TTL expires
- Default cache lifetime for public objects: **60 minutes** if no `Cache-Control` is set
- Use `Cache-Control: no-cache` or `private` for consistency-sensitive data

### Atomic Operations

- Individual operations (upload, delete, metadata update) are **atomic** — partial writes
  never become visible
- Batch requests are **not atomic** — some operations can succeed while others fail

> Source: <https://cloud.google.com/storage/docs/consistency>

---

## Performance Tuning

### Request Rate Guidelines

Cloud Storage scales automatically. General rate guidelines:

| Operation Type | Sustained Rate |
| ---------------- | --------------- |
| Read (GET) | 5,000 req/s per prefix |
| Write (PUT/POST) | 1,000 req/s per prefix |
| List | Same as read rate |

**To scale beyond these limits**, distribute objects across multiple prefixes.

### Latency Characteristics

| Operation | Typical Latency |
| ----------- | ----------------- |
| Small object read (< 1 MB) | 5-20 ms (same region) |
| Large object read (1 MB+) | 50-200 ms + bandwidth time |
| Object write | 10-50 ms + upload time |
| Metadata operations | 5-15 ms |

### File Cache Mode

File caching in gcsfuse significantly improves read performance by storing object content locally:

| Cache Setting | Description | Default | Recommendation |
| --------------- | ------------- | --------- | ---------------- |
| `--file-cache-dir` | Local directory for cache | (disabled) | `/tmp/gcsfuse_cache` or a persistent volume |
| `--file-cache-max-size-mb` | Max cache size in MB | -1 (unlimited) | 1024 (1 GB) |
| `--cache-file-for-range-read` | Cache files opened with range reads | `false` | `true` for random-access workloads |
| `--enable-parallel-downloads` | Download chunks in parallel | `false` | `true` for large files |
| `--download-chunk-size-mb` | Chunk size for parallel downloads | 50 | 50-100 MB |

### Parallel Uploads & Downloads

| Strategy | Recommended Tool | Benefit |
| ---------- | ------------------ | --------- |
| Parallel composite uploads | `gcloud storage cp` (auto) | Faster large file uploads |
| Sliced object downloads | `gcloud storage cp` (auto) | Faster large file downloads |
| gcsfuse parallel downloads | gcsfuse config | Faster read of large files via FUSE |
| gRPC API | gcsfuse with `--grpc` | Lower latency, better throughput |

### Performance Summary

| Factor | Characteristic |
| -------- | --------------- |
| **Read latency** | Higher than local FS (network round-trip). Mitigated by file caching. |
| **Write latency** | Depends on object size. Small writes buffered by gcsfuse, flushed on close. |
| **Throughput** | Scales with parallel operations. Can saturate network bandwidth. |
| **Metadata ops** | `stat`/`ls` are API calls. Stat caching is critical for good gcsfuse performance. |
| **Sequential reads** | Optimized with parallel downloads (chunked). |
| **gRPC** | Lower per-request latency vs JSON API. |

---

## Cloud Storage FUSE (gcsfuse)

### gcsfuse Overview

Cloud Storage FUSE (gcsfuse) is a FUSE adapter that lets you mount Cloud Storage buckets as
local file systems, enabling applications to use standard file system semantics to read and write
objects.

- **Open source** — developed and supported by Google
- **Not POSIX compliant** — not a replacement for NFS, CIFS, or Filestore
- **Free** — you only pay for the underlying Cloud Storage operations generated
- **Supported OS:** Linux (Ubuntu, Debian, Rocky Linux, CentOS, RHEL, SLES) and WSL2
- **Supported architectures:** x86_64, ARM64
- **Validated ML frameworks:** TensorFlow 1.x/2.x, PyTorch 1.x/2.x, JAX 0.4.x

> Source: <https://cloud.google.com/storage/docs/cloud-storage-fuse/overview>

### gcsfuse Installation

```bash
# Debian/Ubuntu
curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | \
    sudo gpg --dearmor -o /usr/share/keyrings/cloud-storage-fuse.gpg
echo "deb [signed-by=/usr/share/keyrings/cloud-storage-fuse.gpg] \
    https://packages.cloud.google.com/apt cloud-storage-fuse-focal main" | \
    sudo tee /etc/apt/sources.list.d/cloud-storage-fuse.list
sudo apt update && sudo apt install gcsfuse

# Rocky Linux/CentOS/RHEL
sudo yum install https://packages.cloud.google.com/yum/repos/cloud-storage-fuse-el8-x86_64.repo
sudo yum install gcsfuse

# Verify installation
gcsfuse --version
```

### gcsfuse Authentication

Cloud Storage FUSE uses Application Default Credentials (ADC) for authentication:

```bash
# Local development — authenticate as user
gcloud auth application-default login

# Compute Engine / Cloud Run — service account automatically available
# No additional setup needed — the instance/service SA is used automatically
```

### gcsfuse Basic Mounting

```bash
# Static mount — mount a specific bucket
mkdir -p /mnt/data
gcsfuse my-bucket /mnt/data

# Dynamic mount — mount all accessible buckets as subdirectories
mkdir -p /mnt/data
gcsfuse /mnt/data

# Mount with implicit directories (flat namespace buckets)
gcsfuse --implicit-dirs my-bucket /mnt/data

# Mount as read-only
gcsfuse -o ro my-bucket /mnt/data

# Mount a specific directory within a bucket
gcsfuse --only-dir a/b my-bucket /mnt/data

# Mount using Linux mount command
sudo mount -t gcsfuse -o rw,user my-bucket /mnt/data

# Mount with all performance options enabled
gcsfuse \
    --implicit-dirs \
    --file-cache-dir=/tmp/gcs_cache \
    --file-cache-max-size-mb=1024 \
    --enable-parallel-downloads \
    --cache-file-for-range-read \
    --stat-cache-capacity=5000 \
    --stat-cache-ttl=60s \
    --type-cache-ttl=60s \
    my-bucket /mnt/data

# Unmount
fusermount -u /mnt/data   # Linux
umount /mnt/data           # Alternative
```

### gcsfuse Mounting Options

| Option | Description | Default |
| -------- | ------------- | --------- |
| `--implicit-dirs` | Infer implicitly-defined directories (required for flat namespace) | `false` |
| `--only-dir` | Mount only a specific directory within the bucket | (none) |
| `--file-cache-dir` | Local directory for file cache | (none — disabled) |
| `--file-cache-max-size-mb` | Max file cache size in MB | -1 (unlimited) |
| `--enable-parallel-downloads` | Download file chunks in parallel | `false` |
| `--cache-file-for-range-read` | Cache files opened with range reads | `false` |
| `--download-chunk-size-mb` | Chunk size for parallel downloads | 50 |
| `--stat-cache-capacity` | Number of stat cache entries | 5000 |
| `--stat-cache-ttl` | Stat cache TTL duration | `60s` |
| `--type-cache-ttl` | Type cache TTL duration | `60s` |
| `--max-retry-sleep` | Max retry backoff for failed requests | `30s` |
| `--foreground` | Stay in foreground for debug logging | `false` |
| `--log-severity` | Log level (`trace`, `debug`, `info`, `warning`, `error`) | `warning` |

### gcsfuse Caching

| Cache Type | What it Caches | Benefit |
| ------------ | ---------------- | --------- |
| **File cache** | Object content on local disk | Faster reads, reduced network cost |
| **Stat cache** | File metadata (size, mtime) | Faster `ls`, `stat`, reduced API calls |
| **List cache** | Directory listings | Faster `ls` on directories |
| **Type cache** | File/directory type | Faster `stat` for type lookup |

### gcsfuse Configuration File

Create a YAML configuration file for cleaner management:

```yaml
# ~/.config/gcsfuse/config.yaml or --config-file path

file-cache:
  enable-parallel-downloads: true
  max-size-mb: 2048
  cache-file-for-range-read: true
  download-chunk-size-mb: 50

metadata-cache:
  stat-cache-capacity: 5000
  stat-cache-ttl: 60s
  type-cache-ttl: 60s

gcs-retries:
  max-retry-sleep: 30s

logging:
  severity: warning

implicit-dirs: true
```

```bash
gcsfuse --config-file=gcsfuse-config.yaml my-bucket /mnt/data
```

### gcsfuse Performance Characteristics

| Factor | Characteristic |
| -------- | --------------- |
| **Read latency** | Higher than local FS (network round-trip). Mitigated by file caching. |
| **Write latency** | Depends on object size. Small writes are buffered, flushed on file close. |
| **Throughput** | Scales with parallel operations. Can saturate network bandwidth. |
| **Metadata ops** | `stat`/`ls` are API calls. Stat caching is critical for performance. |
| **Sequential reads** | Optimized with parallel downloads (chunked). |
| **Concurrent connections** | Linux default limit: 1,024 open file handles. Increase for servers. |

### gcsfuse Known Limitations

| Limitation | Detail |
| ------------ | -------- |
| **No POSIX locks** | `flock()`, `fcntl()` locks not supported |
| **No hard links** | Object storage doesn't support hard links |
| **No append mode** | `O_APPEND` not supported; must rewrite entire object |
| **No chmod/chown** | POSIX permissions not applicable |
| **No atomic rename** (flat namespace) | Renames require copy + delete |
| **No file patching** | Whole object writes only (exception: append to 2MB+ files) |
| **Concurrent writers** | Last-writer-wins to same object from different mounts |
| **Large directories** | Listing performance degrades with millions of objects |
| **No retention policy support** | Cannot write to buckets with retention policy |
| **Object versioning** | Not supported — produces unpredictable behavior |
| **Transcoding** | gzipped objects remain compressed in FUSE (no decompressive transcoding) |

---

## gcsfuse in Cloud Run

### Cloud Run Volume Mount Setup

Cloud Run supports mounting Cloud Storage buckets as volumes using the Cloud Storage FUSE CSI
driver. This is the **recommended way** to access GCS from Cloud Run.

### Cloud Run Deployment Commands

```bash
# Deploy with GCS volume
gcloud run deploy my-service \
    --image gcr.io/my-project/my-image \
    --add-volume=name=ticker-data,type=cloud-storage,bucket=my-ticker-bucket \
    --add-volume-mount=volume=ticker-data,mount-path=/data

# With mount options
gcloud run deploy my-service \
    --image gcr.io/my-project/my-image \
    --add-volume=name=ticker-data,type=cloud-storage,bucket=my-ticker-bucket,readonly=false \
    --add-volume-mount=volume=ticker-data,mount-path=/data
```

### Cloud Run YAML Configuration

```yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: crypto-radar-service
spec:
  template:
    spec:
      serviceAccountName: crypto-radar-sa@project.iam.gserviceaccount.com
      volumes:
        - name: ticker-data
          csi:
            driver: gcsfuse.run.googleapis.com
            volumeAttributes:
              bucketName: crypto-radar-ticker-data
              mountOptions: "implicit-dirs=true,file-cache-max-size-mb=1024,stat-cache-ttl=60s"
      containers:
        - image: gcr.io/my-project/crypto-radar
          volumeMounts:
            - name: ticker-data
              mountPath: /data
          resources:
            limits:
              cpu: "1"
              memory: "512Mi"
```

### Cloud Run Important Notes

- The Cloud Run service account needs `roles/storage.objectAdmin` (or at minimum
  `storage.objects.create`, `storage.objects.get`, `storage.objects.list`) on the bucket
- The mount is **read-write by default**
- File caching can **persist across container instances** in the same Cloud Run zone
- Each Cloud Run instance gets its **own gcsfuse mount** — concurrent writes to the same
  object are last-writer-wins
- gcsfuse runs as a sidecar in Cloud Run (no additional configuration needed)
- Soft delete is **compatible** with gcsfuse writes

### Cloud Run Mount Options

| Option | Description |
| -------- | ------------- |
| `implicit-dirs` | Enable for flat namespace buckets (no hierarchical namespace) |
| `file-cache-max-size-mb` | Local file cache size in MB per instance |
| `stat-cache-ttl` | Stat cache TTL (e.g., `60s`) |
| `type-cache-ttl` | Type cache TTL |
| `stat-cache-capacity` | Number of stat cache entries |

---

## gcloud CLI Commands Reference

### gcloud Bucket Operations

```bash
# List all buckets in current project
gcloud storage buckets list

# List with formatting
gcloud storage buckets list --format="json"
gcloud storage buckets list --format="table(name,location,storageClass,creationTime)"

# Get bucket metadata
gcloud storage buckets describe gs://my-bucket

# Get bucket IAM policy
gcloud storage buckets get-iam-policy gs://my-bucket

# Update bucket (example: change default storage class)
gcloud storage buckets update gs://my-bucket --default-storage-class=NEARLINE

# Delete bucket (must be empty)
gcloud storage buckets delete gs://my-bucket
```

### gcloud Object Operations

```bash
# List objects in a bucket
gcloud storage objects list gs://my-bucket

# List with prefix (like a directory)
gcloud storage objects list gs://my-bucket/data/2024/

# List with wildcard
gcloud storage objects list gs://my-bucket/data/**/*.csv

# Upload a file
gcloud storage cp local-file.csv gs://my-bucket/data/ticker-BTCUSD.csv

# Upload with specific storage class
gcloud storage cp local-file.csv gs://my-bucket/data/ --storage-class=NEARLINE

# Upload directory recursively
gcloud storage cp ./data/ gs://my-bucket/data/ --recursive

# Download a file
gcloud storage cp gs://my-bucket/data/ticker-BTCUSD.csv ./downloads/

# Download recursively
gcloud storage cp gs://my-bucket/data/ ./local-data/ --recursive

# Copy between buckets
gcloud storage cp gs://source-bucket/data.csv gs://dest-bucket/data.csv

# Move/rename (copy + delete)
gcloud storage mv gs://my-bucket/old-path/file.csv gs://my-bucket/new-path/file.csv

# Delete an object
gcloud storage rm gs://my-bucket/data/old-file.csv

# Delete with prefix (recursive)
gcloud storage rm gs://my-bucket/data/2023/ --recursive

# Streaming upload
cat data.csv | gcloud storage cp - gs://my-bucket/data/stream.csv
```

### gcloud IAM Operations

```bash
# Add IAM binding (bucket level — preferred)
gcloud storage buckets add-iam-policy-binding gs://my-bucket \
    --member=serviceAccount:sa@project.iam.gserviceaccount.com \
    --role=roles/storage.objectAdmin

# Add IAM binding (project level)
gcloud projects add-iam-policy-binding my-project \
    --member=serviceAccount:sa@project.iam.gserviceaccount.com \
    --role=roles/storage.objectViewer

# Add IAM binding with condition
gcloud storage buckets add-iam-policy-binding gs://my-bucket \
    --member=serviceAccount:sa@project.iam.gserviceaccount.com \
    --role=roles/storage.objectViewer \
    --condition="expression=resource.name.startsWith('projects/_/buckets/my-bucket/objects/raw/'),title=restrict-to-raw"

# Remove IAM binding
gcloud storage buckets remove-iam-policy-binding gs://my-bucket \
    --member=serviceAccount:sa@project.iam.gserviceaccount.com \
    --role=roles/storage.objectViewer
```

### gcloud Lifecycle Operations

```bash
# Apply lifecycle config from JSON file
gcloud storage buckets update gs://my-bucket --lifecycle-file=lifecycle.json

# Get lifecycle config
gcloud storage buckets describe gs://my-bucket --format="get(lifecycle)"

# Apply inline (limited syntax)
gcloud storage buckets update gs://my-bucket \
    --lifecycle="action=Delete,condition=age=365"

# Remove lifecycle config
gcloud storage buckets update gs://my-bucket --clear-lifecycle
```

### gcloud Monitoring & Logging

```bash
# Get bucket size
gcloud storage buckets describe gs://my-bucket --format="get(size)"

# Check IAM policy
gcloud storage buckets get-iam-policy gs://my-bucket

# Check for public access
gcloud storage buckets list --filter="iamConfiguration.publicAccessPrevention=enforced"

# View object count
gcloud storage objects list gs://my-bucket --count
```

### gsutil (Legacy — for advanced operations)

```bash
# Requester pays
gsutil requesterpays set on gs://my-bucket

# Set object metadata
gsutil setmeta -h "Cache-Control:no-cache" gs://my-bucket/object.csv

# Label operations
gsutil label ch -l environment=prod gs://my-bucket
gsutil label get gs://my-bucket
```

> **Note:** Google recommends migrating from `gsutil` to `gcloud storage` for most operations.
> The `gcloud storage` command provides the same functionality with a unified interface and
> improved performance (parallel composite uploads, sliced downloads).

---

## Best Practices for Crypto Ticker Data

### Crypto Data Model

For crypto ticker data (time-series, append-only CSV files), the recommended storage pattern is:

```
gs://crypto-radar-ticker-data/
├── raw/
│   ├── year=2024/
│   │   ├── month=01/
│   │   │   ├── ticker-BTCUSD-2024-01-01.csv
│   │   │   ├── ticker-BTCUSD-2024-01-02.csv
│   │   │   └── ...
│   │   ├── month=02/
│   │   │   └── ...
│   │   └── ...
│   ├── year=2025/
│   │   └── ...
├── archive/
│   ├── year=2024/
│   │   ├── ticker-BTCUSD-2024-Q1.csv.gz
│   │   ├── ticker-BTCUSD-2024-Q2.csv.gz
│   │   └── ...
├── latest/
│   ├── ticker-BTCUSD.csv
│   ├── ticker-ETHUSD.csv
│   └── ...
```

### Crypto Recommendations

| Concern | Recommendation |
| --------- | --------------- |
| **Bucket location** | Same region as compute (`us-central1` for Cloud Run in us-central1) |
| **Storage class** | Standard for writes/latest; lifecycle → Nearline → Coldline for aging |
| **File format** | CSV with headers for ticker data; Gzip for archives |
| **Naming convention** | `ticker-{SYMBOL}-{YYYY-MM-DD}.csv` — sortable by prefix |
| **Partitioning** | By year/month/day in prefix — efficient for lifecycle and queries |
| **Append mode** | gcsfuse does NOT support POSIX append. Use new files per batch. |
| **Concurrent writes** | Last-writer-wins. Use unique file names per batch to avoid conflicts. |
| **Soft delete** | Keep 7-day soft delete to recover from accidental deletion |
| **Versioning** | Consider Object Versioning if overwrite protection is needed |
| **Batch size** | Aggregate tickers into 5–15 minute files, not per-tick files |
| **Data retention** | Use lifecycle rules to auto-archive and delete old data |
| **Free tier tracking** | Monitor storage via `gcloud storage buckets describe --format="get(size)"` |

### Crypto Sample Lifecycle

```json
{
  "lifecycle": {
    "rule": [
      {
        "description": "Archive ticker data to Nearline after 30 days",
        "action": {"type": "SetStorageClass", "storageClass": "NEARLINE"},
        "condition": {"age": 30, "matchesPrefix": ["raw/ticker-"]}
      },
      {
        "description": "Transition to Coldline after 90 days",
        "action": {"type": "SetStorageClass", "storageClass": "COLDLINE"},
        "condition": {"age": 90, "matchesPrefix": ["raw/ticker-"]}
      },
      {
        "description": "Delete raw ticker data older than 365 days (keep archives only)",
        "action": {"type": "Delete"},
        "condition": {"age": 365, "matchesPrefix": ["raw/ticker-"]}
      },
      {
        "description": "Abort stale multipart uploads after 1 day",
        "action": {"type": "AbortIncompleteMultipartUpload"},
        "condition": {"age": 1}
      }
    ]
  }
}
```

### Crypto Performance Considerations

| Scenario | Approach |
| ---------- | ---------- |
| **Appending new ticks** | Write new files per batch (e.g., every 5-15 min), not per tick |
| **Querying recent data** | Use gcsfuse with file caching for `latest/` and recent `raw/` prefixes |
| **Historical queries** | Use `gcloud storage cp` directly for bulk downloads (bypasses FUSE overhead) |
| **High-frequency writes** | Batch writes into larger files (reduces API operation costs) |
| **Cross-region access** | Use a single-region bucket co-located with compute |
| **Monitoring costs** | Use `gcloud storage buckets describe --format="get(size)"` and Cloud Billing reports |
| **IAM efficiency** | Grant bucket-level, not project-level, permissions |

### Crypto Sample Python Script

```python
from google.cloud import storage
from datetime import datetime, timezone
import csv
import io

client = storage.Client()
bucket = client.bucket("crypto-radar-ticker-data")

def upload_ticker_batch(symbol: str, tickers: list[dict]) -> str:
    """
    Upload a batch of ticker data to Cloud Storage.

    Args:
        symbol: Trading pair symbol (e.g., 'BTCUSD')
        tickers: List of ticker dicts with keys: timestamp, price, volume, bid, ask

    Returns:
        The blob name that was created
    """
    now = datetime.now(timezone.utc)
    year = now.strftime("%Y")
    month = now.strftime("%m")
    day = now.strftime("%d")
    timestamp = now.strftime("%Y%m%d-%H%M%S")

    # Build CSV content in memory
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["timestamp", "price", "volume", "bid", "ask"])
    for t in tickers:
        writer.writerow([
            t.get("timestamp"),
            t.get("price"),
            t.get("volume"),
            t.get("bid"),
            t.get("ask"),
        ])

    blob_name = f"raw/year={year}/month={month}/day={day}/ticker-{symbol}-{timestamp}.csv"
    blob = bucket.blob(blob_name)
    blob.upload_from_string(
        output.getvalue(),
        content_type="text/csv",
    )
    print(f"Uploaded {blob_name} ({len(tickers)} ticks)")
    return blob_name


def get_latest_ticker(symbol: str) -> str | None:
    """
    Read the latest ticker CSV for a given symbol.
    Returns the CSV content as a string, or None.
    """
    blobs = list(bucket.list_blobs(prefix=f"latest/ticker-{symbol}"))
    if not blobs:
        return None
    # Get the most recent (last modified)
    latest = max(blobs, key=lambda b: b.updated)
    return latest.download_as_string().decode("utf-8")


def list_ticker_files(symbol: str, year: str, month: str) -> list[str]:
    """List all ticker files for a given symbol, year, and month."""
    prefix = f"raw/year={year}/month={month}/ticker-{symbol}"
    blobs = bucket.list_blobs(prefix=prefix)
    return [b.name for b in blobs]
```

---

## References

| Resource | URL |
| ---------- | ----- |
| Cloud Storage Documentation | <https://cloud.google.com/storage/docs> |
| Product Overview | <https://cloud.google.com/storage/docs/introduction> |
| Creating Buckets | <https://cloud.google.com/storage/docs/creating-buckets> |
| Bucket Locations | <https://cloud.google.com/storage/docs/locations> |
| Storage Classes | <https://cloud.google.com/storage/docs/storage-classes> |
| Uniform Bucket-Level Access | <https://cloud.google.com/storage/docs/uniform-bucket-level-access> |
| Object Lifecycle Management | <https://cloud.google.com/storage/docs/lifecycle> |
| Lifecycle Configuration Examples | <https://cloud.google.com/storage/docs/lifecycle-configurations> |
| IAM for Cloud Storage | <https://cloud.google.com/storage/docs/access-control/iam> |
| IAM Roles for Cloud Storage | <https://cloud.google.com/storage/docs/access-control/iam-roles> |
| Cloud Storage Consistency | <https://cloud.google.com/storage/docs/consistency> |
| Request Rate & Performance | <https://cloud.google.com/storage/docs/request-rate> |
| Cloud Storage FUSE Overview | <https://cloud.google.com/storage/docs/cloud-storage-fuse/overview> |
| Install Cloud Storage FUSE | <https://cloud.google.com/storage/docs/cloud-storage-fuse/install> |
| Mount Buckets with gcsfuse | <https://cloud.google.com/storage/docs/cloud-storage-fuse/mount-bucket> |
| gcsfuse Caching | <https://cloud.google.com/storage/docs/cloud-storage-fuse/caching> |
| gcsfuse Performance | <https://cloud.google.com/storage/docs/cloud-storage-fuse/performance> |
| gcsfuse GitHub | <https://github.com/GoogleCloudPlatform/gcsfuse> |
| Cloud Storage Pricing | <https://cloud.google.com/storage/pricing> |
| GCP Free Tier | <https://cloud.google.com/free/docs/gcp-free-tier> |
| Pricing Calculator | <https://cloud.google.com/products/calculator> |
| gcloud Storage CLI | <https://cloud.google.com/sdk/gcloud/reference/storage> |
| gsutil Tool | <https://cloud.google.com/storage/docs/gsutil> |
| Cloud Run + GCS Volumes | <https://cloud.google.com/run/docs> |
| Terraform google_storage_bucket | <https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/storage_bucket> |
