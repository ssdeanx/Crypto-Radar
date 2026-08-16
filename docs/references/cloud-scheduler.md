# Cloud Scheduler Reference

> **Fully managed cron service** for triggering Cloud Run, Pub/Sub, App Engine, and HTTP/S targets on a schedule. Designed for "at least once" delivery — code defensively with idempotent handlers.

---

## Overview

Google Cloud Scheduler is a fully managed cron service that executes jobs on a recurring schedule. Each job is sent to a **target** at a specified **frequency** (unix-cron compatible). Jobs run at least once per scheduled execution; in rare circumstances a job may run multiple times for the same schedule instance.

**Key principle:** Targets **must be idempotent** — repeated execution must not produce harmful side effects.

---

## Target Types

| Target | Description | Use Case |
| -------- | ------------- | ---------- |
| **HTTP/S** | Any publicly accessible HTTP/HTTPS endpoint | Triggering Cloud Run services, external APIs, webhooks |
| **Pub/Sub** | Publish a message to a Pub/Sub topic | Event-driven fan-out, async processing pipelines |
| **App Engine HTTP** | App Engine service within the same project | Legacy App Engine apps, same-project services |

### Internal Ingress (VPC)

Cloud Scheduler can invoke the following services **internally** (within the same project or VPC Service Controls perimeter):

- **Cloud Run** (via `run.app` URL — not custom domains)
- **Cloud Run functions** (2nd gen)

To use internal invocation, the target must restrict ingress to internal traffic only.

---

## Scheduling (Cron Format)

Jobs use standard **unix-cron** compatible schedule strings:

```
* * * * *
│ │ │ │ │
│ │ │ │ └── Day of week (0–6, 0=Sunday)
│ │ │ └──── Month (1–12)
│ │ └────── Day of month (1–31)
│ └──────── Hour (0–23)
└────────── Minute (0–59)
```

### Examples

| Schedule | Meaning |
| ---------- | --------- |
| `0 */3 * * *` | Every 3 hours |
| `0 1 * * *` | Daily at 1:00 AM |
| `*/30 * * * *` | Every 30 minutes |
| `30 6 * * 1-5` | 6:30 AM weekdays |
| `0 0 1 * *` | First of every month at midnight |

Use the `--time-zone` flag (or console Timezone selector) to set the timezone. Defaults to `Etc/UTC`. Accepts IANA timezone names.

### Execution Behavior

- **No concurrent execution:** If a job is still running (or waiting for a response) when the next scheduled time arrives, the new execution **is skipped** until the current one finishes or times out.
- **Delayed starts:** A scheduled start is delayed if the previous execution has not ended when its scheduled time occurs.
- **Deduplication headers:** Cloud Scheduler provides `X-CloudScheduler-ScheduleTime` — this contains the original scheduled invocation time and **remains constant across retry attempts**. Use this + job name for idempotency.

---

## Authentication (HTTP Targets)

Cloud Scheduler supports two token types for authenticating to HTTP targets:

| Token Type | Flag | When to Use |
| ----------- | ------ | ------------- |
| **OIDC (OpenID Connect)** | `--oidc-service-account-email` | General-purpose, most HTTP targets |
| **OAuth2 (Access Token)** | `--oauth-service-account-email` | Google APIs hosted on `*.googleapis.com` |

### Setup Steps

1. **Create a service account** in the same project as the Cloud Scheduler job.
   - Do **not** use the Cloud Scheduler service agent (`service-PROJECT_NUMBER@gcp-sa-cloudscheduler.iam.gserviceaccount.com`) for HTTP auth.
2. **Grant IAM roles** to the service account on the target resource.
3. **Create the job** with the appropriate auth flag.

### Required IAM Roles for Targets

| Target | IAM Role |
| -------- | ---------- |
| Cloud Run | `roles/run.invoker` |
| Cloud Run functions (2nd gen) | `roles/run.invoker` |
| Cloud Run functions (1st gen) | `roles/cloudfunctions.invoker` |
| Service Account attachment | `roles/iam.serviceAccountUser` (for the person creating the job) |

### gcloud Example (OIDC)

```shell
gcloud scheduler jobs create http crypto-scan-job \
    --schedule="0 */3 * * *" \
    --uri="https://my-service-abcdef-uc.a.run.app/api/cron/scan" \
    --http-method=POST \
    --oidc-service-account-email=my-scheduler-sa@my-project.iam.gserviceaccount.com \
    --oidc-token-audience="https://my-service-abcdef-uc.a.run.app"
```

### gcloud Example (OAuth2 — for Google APIs)

```shell
gcloud scheduler jobs create http my-job \
    --schedule="0 */3 * * *" \
    --uri="https://my-api.googleapis.com/v1/endpoint" \
    --oauth-service-account-email=my-sa@my-project.iam.gserviceaccount.com \
    --oauth-token-scope="https://www.googleapis.com/auth/cloud-platform"
```

### Granting Cloud Run Invoker

```shell
gcloud run services add-iam-policy-binding my-service \
    --member=serviceAccount:my-scheduler-sa@my-project.iam.gserviceaccount.com \
    --role=roles/run.invoker
```

### Service Agent Requirement

The Cloud Scheduler **service agent** (`service-PROJECT_NUMBER@gcp-sa-cloudscheduler.iam.gserviceaccount.com`) must have the `roles/cloudscheduler.serviceAgent` role. This is **granted automatically** when you enable the Cloud Scheduler API (unless you enabled it prior to March 19, 2019). Do **not** revoke this role — doing so causes 403 errors even if the job's own service account has the correct permissions.

---

## Retry Policy

Jobs that don't complete successfully are retried with **exponential backoff** according to the configured retry policy.

### Retry Parameters

| Parameter | Flag | Default | Description |
| ----------- | ------ | --------- | ------------- |
| Min backoff | `--min-backoff` | `5s` | Initial delay before first retry |
| Max backoff | `--max-backoff` | `3600s` (1h) | Maximum delay between retries |
| Max doublings | `--max-doublings` | `5` | Times the interval doubles before becoming constant |
| Max retry attempts | `--max-retry-attempts` | `0` | Number of retries (0–5). `0` = no retries |
| Max retry duration | `--max-retry-duration` | `0` (unlimited) | Time limit for retrying from first attempt |
| Attempt deadline | `--attempt-deadline` | (not set) | Per-attempt timeout; if handler doesn't respond by deadline, request is cancelled and marked failed |

All duration values accept unit suffixes: `h`, `m`, `s`, `ms`, `us`, `ns`.

### Retry Behavior

- When `--max-retry-attempts > 0`, a failed job is retried up to that many times with exponential backoff.
- The next scheduled execution may be **delayed or skipped** if retries continue through that time.
- When both `--max-retry-attempts` and `--max-retry-duration` are set, retry stops when **either** limit is reached.
- When both are `0` (defaults), no retries occur.

### Configuring Retries (Console)

In the "Configure optional settings" section when creating a job:

- **Max retry duration:** supports `h`, `m`, `s`
- **Min/Max backoff duration:** supports full set (`h`, `m`, `s`, `ms`, `us`, `ns`)
- Negative and fractional values are not allowed

---

## IAM & Permissions

### Predefined Roles

| Role | Purpose |
| ------ | --------- |
| `roles/cloudscheduler.admin` | Full admin access to Cloud Scheduler |
| `roles/cloudscheduler.viewer` | Read-only access to jobs |
| `roles/cloudscheduler.serviceAgent` | Service agent (auto-granted, do not revoke) |
| `roles/run.invoker` | Invoke Cloud Run services (needed on **target** service) |
| `roles/iam.serviceAccountUser` | Required to attach a service account to a resource |

### Service Agent Identity

```
service-PROJECT_NUMBER@gcp-sa-cloudscheduler.iam.gserviceaccount.com
```

---

## Pricing

| Item | Cost |
| ------ | ------ |
| **Per job (beyond free tier)** | **$0.10 per job per month** |
| **Free tier** | **3 free jobs per billing account** (not per project) |
| Proration | Billed daily: ~$0.003/day per paid job |
| Paused jobs | Counted as active jobs (billed) |

### Free Tier Details

- 3 free jobs per **billing account**, not per project.
- Example: 5 projects with 2 jobs each = 10 jobs total → 3 free + 7 paid = $0.70/month.
- For Crypto Radar (1–3 jobs): **fits entirely in the free tier**.

### Pricing Notes

- Pricing is **per job, not per execution**. Running a job 1000 times costs the same as running it once.
- A "job" is a single cron configuration. Paused jobs still count.
- Use the [GCP Pricing Calculator](https://cloud.google.com/products/calculator) for estimates.

---

## gcloud CLI Reference

### Job Management Commands

| Command | Purpose |
| --------- | --------- |
| `gcloud scheduler jobs create http` | Create HTTP target job |
| `gcloud scheduler jobs create pubsub` | Create Pub/Sub target job |
| `gcloud scheduler jobs create app-engine` | Create App Engine target job |
| `gcloud scheduler jobs update http` | Update HTTP target job config |
| `gcloud scheduler jobs delete` | Delete a job |
| `gcloud scheduler jobs describe` | Get job details |
| `gcloud scheduler jobs list` | List all jobs in a project |
| `gcloud scheduler jobs pause` | Pause execution of a job |
| `gcloud scheduler jobs resume` | Resume execution of a paused job |
| `gcloud scheduler jobs run` | Trigger on-demand execution |

### Creating an HTTP Job (Full Options)

```shell
gcloud scheduler jobs create http JOB_NAME \
    --location=LOCATION \
    --schedule="CRON_EXPRESSION" \
    --uri="TARGET_URL" \
    --http-method=POST \
    --time-zone="Etc/UTC" \
    --description="Human-readable description" \
    --headers="KEY=VALUE" \
    --message-body='{"key":"value"}' \
    --message-body-from-file=FILE_PATH \
    --attempt-deadline=30s \
    --max-retry-attempts=3 \
    --min-backoff=10s \
    --max-backoff=600s \
    --max-doublings=4 \
    --max-retry-duration=3600s \
    --oidc-service-account-email=SA_EMAIL \
    --oidc-token-audience=AUDIENCE_URL
```

### Updating a Job

```shell
# Update retry attempts
gcloud scheduler jobs update http my-job --max-retry-attempts=2

# Update schedule
gcloud scheduler jobs update http my-job --schedule="0 */6 * * *"

# Update auth token (replace existing)
gcloud scheduler jobs update http my-job \
    --oidc-service-account-email=new-sa@project.iam.gserviceaccount.com

# Clear auth token
gcloud scheduler jobs update http my-job --clear-auth-token

# Clear message body
gcloud scheduler jobs update http my-job --clear-message-body
```

### Running a Job On-Demand

```shell
gcloud scheduler jobs run my-job --location=LOCATION
```

### Listing Jobs

```shell
gcloud scheduler jobs list --location=LOCATION
```

---

## Deduplication & Idempotency

Cloud Scheduler provides **at-least-once** delivery semantics. To handle duplicate executions:

1. **`X-CloudScheduler-ScheduleTime` header** — Contains the original scheduled invocation time, constant across retry attempts.
2. **Job name** — Unique within the project.
3. **Combine both** as a deduplication key in your handler.

Example dedup logic (pseudocode):

```python
# In your Cloud Run handler
schedule_time = request.headers.get('X-CloudScheduler-ScheduleTime')
job_name = request.headers.get('X-CloudScheduler-JobName')
dedup_key = f"{job_name}:{schedule_time}"

if not cache.has(dedup_key):
    process_scan()
    cache.set(dedup_key, ttl=3600)
```

---

## Integration with Crypto Radar

### Typical Setup

| Setting | Value |
| --------- | ------- |
| **Target URL** | `https://SERVICE-abcdef-uc.a.run.app/api/cron/scan` |
| **HTTP Method** | `POST` |
| **Schedule** | `*/15 * * * *` (every 15 min) or `0 */1 * * *` (hourly) |
| **Auth** | OIDC token with service account |
| **Target IAM** | `roles/run.invoker` on the Cloud Run service |
| **Free Tier** | 1–3 jobs → **completely free** |

### Step-by-Step

```shell
# 1. Create a dedicated service account
gcloud iam service-accounts create crypto-radar-scheduler \
    --display-name="Crypto Radar Cloud Scheduler SA"

# 2. Grant Cloud Run Invoker to the service account
gcloud run services add-iam-policy-binding crypto-radar \
    --member=serviceAccount:crypto-radar-scheduler@PROJECT_ID.iam.gserviceaccount.com \
    --role=roles/run.invoker

# 3. Create the scheduler job
gcloud scheduler jobs create http crypto-radar-scan \
    --location=us-central1 \
    --schedule="*/15 * * * *" \
    --uri="https://SERVICE-abcdef-uc.a.run.app/api/cron/scan" \
    --http-method=POST \
    --oidc-service-account-email=crypto-radar-scheduler@PROJECT_ID.iam.gserviceaccount.com \
    --oidc-token-audience="https://SERVICE-abcdef-uc.a.run.app" \
    --description="Crypto Radar periodic scan every 15 minutes" \
    --max-retry-attempts=2 \
    --min-backoff=10s \
    --max-backoff=60s \
    --attempt-deadline=120s
```

---

## Region Support

Cloud Scheduler is available in **all Google Cloud regions** for HTTP/S and Pub/Sub targets.

For **App Engine HTTP** targets:

- The job must be created in the **same region as the App Engine app**.
- A GCP project can only have one App Engine app region (set at creation, immutable).

---

## Limits & Quotas

| Resource | Limit |
| ---------- | ------- |
| Max retry attempts | 0–5 |
| Max URL length | 2083 characters (after encoding) |
| Concurrent execution | Single instance per job (subsequent runs skipped) |
| Schedule format | Unix-cron compatible strings |
| Attempt deadline | Configurable (seconds to hours) |

---

## Official Documentation

- [Cloud Scheduler Overview](https://docs.cloud.google.com/scheduler/docs/overview)
- [Creating and Managing Jobs](https://docs.cloud.google.com/scheduler/docs/creating)
- [HTTP Target Authentication](https://docs.cloud.google.com/scheduler/docs/http-target-auth)
- [Retry Jobs](https://cloud.google.com/scheduler/docs/configuring/retry-jobs)
- [Pricing](https://cloud.google.com/scheduler/pricing)
- [gcloud scheduler jobs](https://docs.cloud.google.com/sdk/gcloud/reference/scheduler/jobs)
- [gcloud scheduler jobs create http](https://docs.cloud.google.com/sdk/gcloud/reference/scheduler/jobs/create/http)
- [gcloud scheduler jobs update http](https://docs.cloud.google.com/sdk/gcloud/reference/scheduler/jobs/update/http)
- [Cron Job Schedule Format](https://cloud.google.com/scheduler/docs/configuring/cron-job-schedules)
