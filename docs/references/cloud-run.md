# Cloud Run Reference

> Google Cloud Run is a fully managed serverless platform for running containerized applications on Google's scalable infrastructure. It abstracts away infrastructure management, scales automatically (including to zero), and bills per-use.

**Official docs:** <https://cloud.google.com/run/docs>
**Pricing:** <https://cloud.google.com/run/pricing>
**Container runtime contract:** <https://cloud.google.com/run/docs/container-contract>
**Resource model:** <https://cloud.google.com/run/docs/overview/what-is-cloud-run>

---

## Table of Contents

- [Services vs Jobs vs Worker Pools](#services-vs-jobs-vs-worker-pools)
- [Container Runtime Contract](#container-runtime-contract)
- [Scaling](#scaling)
- [Limitations & Constraints](#limitations--constraints)
- [Cloud Storage Volume Mounts (gcsfuse)](#cloud-storage-volume-mounts-gcsfuse)
- [IAM & Service Identity](#iam--service-identity)
- [Health Checks & Startup Probes](#health-checks--startup-probes)
- [Pricing](#pricing)
- [Free Tier Analysis](#free-tier-analysis)
- [Deploy Commands](#deploy-commands)
- [Crypto Radar Architecture Guidance](#crypto-radar-architecture-guidance)

---

## Services vs Jobs vs Worker Pools

Cloud Run offers three resource types for running code, all sharing the same sandboxed container execution environment.

| Resource | Description | Use Case |
| --- | --- | --- |
| **Service** | Responds to HTTP requests at a stable HTTPS endpoint. Stateless instances autoscale based on request volume, CPU, or events. | APIs, web apps, Pub/Sub push subscriptions, Eventarc-triggered functions, AI inference endpoints |
| **Job** | Executes tasks that run to completion. Can be run manually, on a schedule (via Cloud Scheduler + Workflows), or as part of a workflow. Parallelizable via array jobs. | Batch processing, ETL, database migrations, model training, scheduled data transformations |
| **Worker pool** | Always-on background processing. No HTTP endpoint. Pull-based workloads (Kafka, Pub/Sub pull, RabbitMQ). Manually or externally scaled. | Pub/Sub pull subscribers, Kafka consumers, message queue processors |

### Crypto Radar Guidance

- **Crypto Radar API / web app** → Service (HTTP endpoint for signals, dashboard, alerts API)
- **Price data collection / batch ML inference** → Job (scheduled or triggered)
- **Market data stream consumer** → Service with WebSocket support, or Worker pool for pull-based consumers

---

## Container Runtime Contract

### Supported Images

| Requirement | Detail |
| --- | --- |
| Architecture | Linux x86_64 (linux/amd64) |
| Image formats | Docker V2 Schema 1, Schema 2, OCI |
| Compression | Zstd compressed images supported |
| Base image | Any — user's choice |
| Multi-arch | Manifest list must include `linux/amd64` |

### PORT Environment Variable

- Cloud Run injects `PORT` env var into the **ingress container only** (not sidecars).
- The container must **listen on `0.0.0.0:{PORT}`** (default `8080` if not configured).
- Do **not** listen on `127.0.0.1`.
- You can configure a custom port in the Cloud Run service settings.

### Concurrency (Services Only)

- Default: **multiple** concurrent requests per instance (up to 250+ depending on configuration).
- Concurrency is configurable. Setting to 1 gives one request per instance (useful for CPU-intensive or non-thread-safe code).
- Multiple requests share the same CPU/memory allocation — good for I/O-bound workloads.

### Cloud Run Services — Listen & Respond

- Must listen for HTTP/gRPC requests on the configured port.
- Must respond within the **request timeout** (default 5 min, **max 60 minutes**).
- TLS is terminated at the Cloud Run edge — your container receives plain HTTP/1 or h2c.
- WebSocket and gRPC streaming supported.
- Response with `Set-Cookie` → Cloud Run auto-sets `Cache-Control: private`.

### Cloud Run Jobs — Exit on Completion

- Container must **exit with code 0** on success, non-zero on failure.
- Should **not** listen on a port or start a web server.
- Exit codes: 0 (success), 4 (SIGILL), 7 (SIGBUS), 9 (SIGKILL), 11 (SIGSEGV), 15 (SIGTERM timeout/cancel).

### Environment Variables — Services

| Variable | Description | Example |
| --- | --- | --- |
| `PORT` | Port the HTTP server must listen on | `8080` |
| `K_SERVICE` | Name of the Cloud Run service | `hello-world` |
| `K_REVISION` | Name of the current revision | `hello-world.1` |
| `K_CONFIGURATION` | Name of the configuration | `hello-world` |

### Environment Variables — Jobs

| Variable | Description | Example |
| --- | --- | --- |
| `CLOUD_RUN_JOB` | Name of the job | `hello-world` |
| `CLOUD_RUN_EXECUTION` | Name of the execution | `hello-world-abc` |
| `CLOUD_RUN_TASK_INDEX` | Index of this task (0-based) | `0` |
| `CLOUD_RUN_TASK_ATTEMPT` | Retry attempt number (0-based) | `0` |
| `CLOUD_RUN_TASK_COUNT` | Total number of tasks | `1` |

### Environment Variables — Worker Pools

| Variable | Description | Example |
| --- | --- | --- |
| `CLOUD_RUN_WORKER_POOL` | Name of the worker pool | `hello-world` |
| `CLOUD_RUN_REVISION` | Name of the running revision | `hello-world.1` |

### File System

- **Ephemeral, in-memory** writable overlay. Data does **not** persist across instance shutdowns.
- Writing to the filesystem consumes the instance's RAM. No size limit — can OOM the instance.
- Use **in-memory volumes** with a size limit for controlled temp storage.
- For persistence: use Cloud Storage, Cloud SQL, Firestore, or mount a network filesystem via Cloud Storage volume mounts.
- SIGTERM signal (10-second grace period) before shutdown — trap it to flush buffers.

### Instance Lifecycle — Services

| Phase | Detail |
| --- | --- |
| **Startup** | Must become healthy within **4 minutes**. CPU allocated during startup. Startup CPU boost available. |
| **Request pending** | Requests wait up to **3.5× avg startup time or 10s** (whichever is greater) while an instance starts. |
| **Processing** | CPU allocated while handling requests (request-based billing) or always (instance-based billing). |
| **Idle** | Idle instances kept for up to **15 minutes** before shutdown (unless min instances configured). |
| **Shutdown** | SIGTERM → 10s grace → SIGKILL. In request-based billing, idle (non-min) instances are not charged. |

### Instance Lifecycle — Jobs

- Container runs until exit, timeout reached, or crash.
- CPU always allocated for the entire lifecycle.
- Billed at instance-based rate.

### Security Restrictions

- No privileged mode. No Docker `--privileged` equivalent.
- **setuid/setgid not supported** (including gcsfuse and sudo in non-root contexts).
- gcsfuse workaround: run as root in the entrypoint, then `su` to the app user.
- No system time changes (`adjtimex`, `adjtime`).
- File descriptor hard limit: **25,000**.
- First-gen execution environment uses **gVisor** sandbox (some syscalls unsupported).
- Second-gen environment (recommended, used by jobs) provides full Linux compatibility.

---

## Scaling

### Scale to Zero

- **Default behavior:** When no traffic, all instances are removed.
- If no active instance exists when a request arrives, a cold start occurs.
- **Cold start latency:** ~1–2s for Node.js, faster for compiled languages, slower for JVM.

### Min / Max Instances

| Setting | Effect | Default |
| --- | --- | --- |
| `min-instances` | Keep N instances always warm. Prevents cold starts. **Requires instance-based billing.** | `0` (scale to zero) |
| `max-instances` | Hard cap on concurrent instances. Controls cost and downstream load. | `1000` (default quota) |

- Scaling to zero is great for cost but causes cold start latency on first request after idle.
- Setting `min-instances=1` ensures at least one warm instance always ready.
- **Quota soft limit:** 1000 instances per region per project (can request increase).

### Autoscaling Behavior

- **Request-based:** Scales on incoming request count. Idle instances (not processing requests) are not charged if no min instances set.
- **Instance-based:** CPU always allocated. Scales on CPU utilization.
- Manual scaling option available to override autoscaling.

### Cold Starts

| Language | Typical Cold Start |
| --- | --- |
| **Go** | ~200-400ms |
| **Node.js** | ~1-2s |
| **Python** | ~500ms-2s |
| **Java** | ~2-6s (JVM startup) |
| **.NET** | ~1-3s |

- Use **min-instances** to eliminate cold starts for latency-sensitive endpoints.
- Use **startup CPU boost** (temporarily increased CPU during startup) to reduce latency.

### Deployment Strategy

- Gradual rollouts: route 1% → increase % while monitoring telemetry.
- Traffic splitting across revisions.
- Rollback to previous revision.

---

## Limitations & Constraints

| Constraint | Limit | Notes |
| --- | --- | --- |
| **Request timeout** | **60 minutes** | Configurable per service. Default 5 minutes. Set via `--timeout`. |
| **Job timeout** | **24 hours** | Max execution time per task. |
| **Response size** | 32 MB | Per response (after Cloud Run overhead) |
| **Request size** | 32 MB | Per request (after Cloud Run overhead) |
| **Instance concurrency** | 1000 (default 250?) | Configurable. Depends on CPU/memory. |
| **Instance memory** | 1 GiB to 32 GiB (varies by region) | Configurable. |
| **Instance CPU** | 1 to 8 vCPU | Scales with memory. |
| **Container startup** | 4 minutes max | Must be healthy within 4 min. |
| **Idle instance retention** | 15 min max | Unless min-instances configured. |
| **File descriptors** | 25,000 | Hard limit. |
| **Ephemeral storage** | Limited by container memory | In-memory filesystem. |
| **Max instances** | 1000 per region (default quota) | Can request increase. |
| **SIGTERM grace** | 10 seconds | Between SIGTERM and SIGKILL. |

### What Cloud Run Does NOT Support

- **Standalone WebSocket server:** WebSockets are supported only as part of HTTP request handling (upgrade from HTTP). No persistent WebSocket server that accepts outbound connections independently of requests.
- **Background threads/processing after response:** For request-based billing, CPU is removed after the response completes (instance may still be idle-warm). For instance-based billing, CPU is always on.
- **Filesystem persistence:** The filesystem is in-memory and ephemeral. Use Cloud Storage for persistent data.
- **`--privileged` containers:** No root-on-host capabilities.
- **setuid/setgid binaries:** Including gcsfuse and sudo for non-root. Workaround exists (run as root).
- **System time modification**
- **eBPF** and kernel-level features
- **Docker socket** or host device access
- **Nested volume mounts**
- **Background/daemon container** (Jobs exit, Services must handle requests)

### WebSocket Support

- Cloud Run does support **WebSocket connections** as part of HTTP request lifecycle (HTTP upgrade).
- Works with both request-based and instance-based billing.
- For long-lived WebSocket connections, set the request timeout appropriately.
- If you keep a WebSocket connection open, the instance is considered "processing" and CPU is allocated.

---

## Cloud Storage Volume Mounts (gcsfuse)

Cloud Run supports mounting Cloud Storage buckets as volumes on Cloud Run services and jobs. This is the preferred way to persist files without using gcsfuse inside the container.

**Key facts:**

- Configured via the `--add-volume` and `--add-volume-mount` flags at deployment.
- Volumes are mounted before the container starts.
- Mounted buckets appear as a regular filesystem within the container.
- Works with both services and jobs.
- Does not require gcsfuse inside the container — handled by Cloud Run infrastructure.
- Access is governed by the **service identity** (service account) attached to the Cloud Run revision.

**Workaround for older gcsfuse usage:**

- If you need to run `gcsfuse` inside the container, run as root in the entrypoint, then `su` to the app user (because `setuid` is not supported).

**Example deploy with volume mount:**

```bash
gcloud run deploy myservice \
  --add-volume=name=myvol,bucket=my-bucket \
  --add-volume-mount=volume=myvol,mount-path=/data
```

---

## IAM & Service Identity

### Two Identities

| Identity | Description |
| --- | --- |
| **Deployer account** | User or service account that deploys/manages Cloud Run resources. Needs `run.admin` or `run.developer`. |
| **Service identity** | Service account that the running container uses to call Google Cloud APIs. |

### Key Roles

| Role | Permission | Use |
| --- | --- | --- |
| `roles/run.invoker` | `run.routes.invoke` | Allow unauthenticated or service-to-service invocation |
| `roles/run.admin` | Full control | Deploy, manage, delete |
| `roles/run.developer` | Deploy & modify | Cannot delete |
| `roles/run.viewer` | Read-only | List, get, view |
| `roles/iam.serviceAccountUser` | Act as service account | Needed to deploy with a user-managed SA |

### Service Identity Best Practices

- **Use user-managed service accounts** (not the default Compute Engine SA).
- Grant only the minimal permissions needed (least privilege).
- Disable automatic IAM grants for default service accounts (`iam.automaticIamGrantsForDefaultServiceAccounts`).
- Never set `GOOGLE_APPLICATION_CREDENTIALS` as an env var — use ADC via the service identity.

### Fetching Tokens at Runtime

```bash
# OAuth2 access token (for Google Cloud APIs)
curl "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" \
    -H "Metadata-Flavor: Google"

# ID token (for service-to-service auth)
curl "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=https://SERVICE_ID" \
    -H "Metadata-Flavor: Google"
```

### Invocation Types

| Method | Auth |
| --- | --- |
| **Public (allow unauthenticated)** | Anyone with the URL, no IAM check |
| **Private (require authentication)** | Must have `run.invoker` and send OAuth2/ID token |
| **Ingress restricted** | Limit to internal (VPC) or internal+CLB traffic |
| **IAP** | Identity-Aware Proxy for user-facing auth |

---

## Health Checks & Startup Probes

### Startup Probe (Services)

- Determines if the container has started and is ready to serve.
- If the startup probe fails, the instance is not sent traffic.
- Configurable via `--startup-probe`:

  ```bash
  gcloud run deploy myservice \
    --startup-probe="/healthz" \
    --startup-probe-initial-delay=0 \
    --startup-probe-period=3
  ```

### Container Startup Order (Multi-container)

- You can specify dependencies between containers in an instance.
- Sidecar containers must be healthy before the ingress container receives traffic.

### Health Check Behavior (Services)

- If an instance fails health checks after startup, Cloud Run stops routing traffic to it and starts a new instance.
- No health checks for Jobs (they run to completion).
- Worker pools use startup probes but don't have continuous health checks.

---

## Pricing

### Billing Models

| Model | How It Works | Best For |
| --- | --- | --- |
| **Request-based** (default) | Pay only when processing requests. Idle instances (no min-instances) not charged. Per-request fee. | Variable traffic, scale-to-zero workloads |
| **Instance-based** | Pay for entire instance lifetime (1 min minimum). No per-request fee. | Min instances, always-on, high throughput, CPU-heavy workloads |

### Instance-based Pricing (us-central1)

| Resource | Default | 1yr CUD | 3yr CUD |
| --- | --- | --- | --- |
| **CPU** (per vCPU-second) | `$0.000018` | `$0.00001494` | `$0.00001494` |
| **Memory** (per GiB-second) | `$0.000002` | `$0.00000166` | `$0.00000166` |
| **GPU (L4, no redundancy)** | `$0.0001867/s` | — | — |
| **GPU (RTX 6000, no redundancy)** | `$0.00036522/s` | — | — |

### Request-based Pricing (us-central1)

| Resource | Active Time | Idle Time (min-instances) |
| --- | --- | --- |
| **CPU** (per vCPU-second) | `$0.000024` | `$0.0000025` |
| **Memory** (per GiB-second) | `$0.0000025` | `$0.0000025` |
| **Requests** (per million) | `$0.40` | N/A |

### Jobs Pricing (us-central1)

Same as instance-based pricing for services. No per-request fee.

| Resource | Default |
| --- | --- |
| **CPU** (per vCPU-second) | `$0.000018` |
| **Memory** (per GiB-second) | `$0.000002` |

### Worker Pool Pricing (us-central1)

| Resource | Default |
| --- | --- |
| **CPU** (per vCPU-second) | `$0.000011244` |
| **Memory** (per GiB-second) | `$0.000001235` |

### Data Transfer

- **Free within same region** (e.g., Cloud Run to Cloud Run, Cloud Run to Cloud SQL in same region).
- **1 GiB free outbound per month** within North America.
- Outbound data transfer uses Premium Network Service Tier.
- No charge for data transfer to Media CDN, Cloud CDN, or Cloud Load Balancing.

### Other Charges

- Cloud Build (when deploying from source)
- Artifact Registry (image storage)
- Eventarc (event delivery)
- Serverless VPC Access connectors (if using VPC connectivity)

---

## Free Tier Analysis

Free tier allocation (per billing account, resets monthly, aggregated across projects):

### Services (Instance-based billing)

| Resource | Free Tier | Equivalent Runtime |
| --- | --- | --- |
| **CPU** | 240,000 vCPU-seconds/mo | ~66.7 hours of 1 vCPU |
| **Memory** | 450,000 GiB-seconds/mo | ~125 hours of 1 GiB |

### Services (Request-based billing)

| Resource | Free Tier | Equivalent |
| --- | --- | --- |
| **CPU** | 180,000 vCPU-seconds/mo | ~50 hours of 1 vCPU active |
| **Memory** | 360,000 GiB-seconds/mo | ~100 hours of 1 GiB active |
| **Requests** | 2 million requests/mo | ~66,666 req/day |

### Jobs

| Resource | Free Tier |
| --- | --- |
| **CPU** | 240,000 vCPU-seconds/mo |
| **Memory** | 450,000 GiB-seconds/mo |

### Worker Pools

| Resource | Free Tier |
| --- | --- |
| **CPU** | 384,204 vCPU-seconds/mo |
| **Memory** | 728,744 GiB-seconds/mo |

### Crypto Radar Free Tier Feasibility

| Scenario | Free Tier Covers? |
| --- | --- |
| **Weekly deployment (build + run)** | ✅ Yes — 1 deploy/week is negligible |
| **1 API endpoint, scale-to-zero, 10k req/mo** | ✅ Yes — well within free tier |
| **Scheduled job runs daily (1 vCPU, 1 GiB, 5 min)** | ✅ Yes — ~150 min/mo = ~9,000 vCPU-s + 9,000 GiB-s |
| **Always-on service (1 instance, min-instances=1)** | ❌ No — 24/7 = 2,592,000 vCPU-s/mo, far over free tier |
| **Multiple services with low traffic** | ✅ Likely if total < ~66h vCPU active time |
| **Batch ML job (4 vCPU, 4 GiB, 30 min, daily)** | ❌ Probably over — 360,000 vCPU-s + 360,000 GiB-s per mo |

**Bottom line:** The free tier is sufficient for development, low-traffic APIs, and periodic batch jobs. For any always-on or high-throughput production workload, expect to pay beyond the free tier.

---

## Deploy Commands

### Service Deployment

```bash
# Deploy a container image as a service
gcloud run deploy SERVICE_NAME \
  --image=us-docker.pkg.dev/cloudrun/container/job:latest \
  --region=us-central1 \
  --platform=managed \
  [--allow-unauthenticated] \
  [--concurrency=80] \
  [--cpu=1] \
  [--memory=512Mi] \
  [--max-instances=10] \
  [--min-instances=0] \
  [--timeout=300] \
  [--service-account=SA_EMAIL] \
  [--set-env-vars=KEY=VALUE] \
  [--add-volume=name=vol1,bucket=bucket-name] \
  [--add-volume-mount=volume=vol1,mount-path=/data]
```

### Job Creation & Execution

```bash
# Create a job
gcloud run jobs create JOB_NAME \
  --image=IMAGE_URL \
  --region=us-central1 \
  --tasks=10 \
  --parallelism=5 \
  --max-retries=3 \
  --task-timeout=3600 \
  --cpu=2 \
  --memory=1Gi \
  --service-account=SA_EMAIL

# Execute a job
gcloud run jobs execute JOB_NAME \
  --region=us-central1 \
  --tasks=10

# Execute a job with overrides (ad-hoc)
gcloud run jobs execute JOB_NAME \
  --region=us-central1 \
  --tasks=5 \
  --args="--date=2025-01-01"
```

### Traffic & Revisions

```bash
# Split traffic between revisions
gcloud run services update-traffic SERVICE_NAME \
  --region=us-central1 \
  --to-revisions=REV1=90,REV2=10

# Rollback to a previous revision
gcloud run services update-traffic SERVICE_NAME \
  --region=us-central1 \
  --to-revisions=REV1=100

# Migrate all traffic to latest revision
gcloud run services update-traffic SERVICE_NAME \
  --region=us-central1 \
  --to-latest
```

---

## Crypto Radar Architecture Guidance

### Recommended Setup

```
┌─────────────────────────────────────────────────────┐
│  Cloud Run Service (API)                             │
│  - HTTP endpoint for signals, dashboard, alerts      │
│  - Scale-to-zero (min-instances=1 if latency matters)│
│  - Request-based billing (lower traffic)             │
│  - 1 vCPU, 512Mi-1Gi                                 │
│  - Concurrency: ~80 for I/O-bound, 1 for CPU-heavy   │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│  Cloud Run Job (Batch Processing)                    │
│  - Scheduled market data collection                  │
│  - Batch ML inference (price prediction)             │
│  - Instance-based billing (CPU always on during job) │
│  - Use array jobs for parallelized processing        │
│  - 2-4 vCPU, 1-4 GiB depending on workload          │
└─────────────────────────────────────────────────────┘
```

### Free Tier Optimization Tips

1. **Use scale-to-zero** for API services — no idle cost.
2. **Use Jobs** for batch work instead of always-on services.
3. **Keep CPU/memory minimal** — 1 vCPU / 512 MiB for most crypto data processing.
4. **Batch array jobs** — use `--tasks` and `--parallelism` to process many symbols in parallel within a single job execution.
5. **Set max-instances** to prevent runaway scaling.
6. **Use Cloud Scheduler + Workflows** to trigger job executions on a cron schedule.
7. **Avoid min-instances** in dev/staging — only use in production if latency is critical.

### Estimated Monthly Costs (Beyond Free Tier)

| Scenario | Configuration | Est. Monthly Cost |
| --- | --- | --- |
| API, 100k req/mo, 200ms each, 1 vCPU, 512 MiB, request-based | ~5.6 active hours | **$0.00–0.50** (likely free) |
| API, 10M req/mo, 400ms each, 1 vCPU, 512 MiB, concurrency=20 | Medium traffic | **~$13–20** |
| Job, 1x/hr, 1 min, 1 vCPU, 512 MiB | 730 exec/mo | **~$0.00** (free tier covers) |
| Job, 2x/day, 30 min, 4 vCPU, 4 GiB | 60 exec/mo | **~$1–3** |
| Always-on 1 instance (min=1), 1 vCPU, 1 GiB, instance-based | 24/7 | **~$50** |
| Always-on + moderate traffic, min=2 | 24/7 + request cycles | **~$100+** |

---

## References

- [What is Cloud Run](https://cloud.google.com/run/docs/overview/what-is-cloud-run)
- [Container Runtime Contract](https://cloud.google.com/run/docs/container-contract)
- [Cloud Run Pricing](https://cloud.google.com/run/pricing)
- [Cloud Run Service Identity](https://cloud.google.com/run/docs/securing/service-identity)
- [Configuring Services](https://cloud.google.com/run/docs/configuring/services)
- [Creating Jobs](https://cloud.google.com/run/docs/creating-jobs)
- [Scaling Services](https://cloud.google.com/run/docs/scaling)
- [Cost Optimization](https://cloud.google.com/run/docs/cost-optimization)
- [gcloud run deploy reference](https://cloud.google.com/sdk/gcloud/reference/run/deploy)
- [gcloud run jobs reference](https://cloud.google.com/sdk/gcloud/reference/run/jobs)
