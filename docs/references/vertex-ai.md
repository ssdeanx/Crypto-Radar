# Vertex AI (Gemini Enterprise Agent Platform) Reference

> **Note:** Vertex AI has been rebranded as **Gemini Enterprise Agent Platform** (often referred to simply as "Agent Platform" in current GCP documentation). The legacy Vertex AI branding still appears in some SDK packages and documentation. URLs migrated from `cloud.google.com/vertex-ai/docs/...` to `docs.cloud.google.com/gemini-enterprise-agent-platform/...`.

---

## Table of Contents

1. [Overview](#overview)
2. [Vertex AI Datasets (Managed Datasets)](#vertex-ai-datasets)
3. [Vertex AI Experiments](#vertex-ai-experiments)
4. [Gemini API on Vertex AI](#gemini-api-on-vertex-ai)
5. [Vertex AI Model Registry](#vertex-ai-model-registry)
6. [BigQuery ML](#bigquery-ml)
7. [@google-cloud/vertexai npm Package](#google-cloud-vertexai-npm-package)
8. [Pricing & Free Tier](#pricing--free-tier)
9. [Links & References](#links--references)

---

## Overview

Gemini Enterprise Agent Platform is Google Cloud's unified ML platform. It provides:

- **Managed datasets** for training AutoML and custom models
- **AutoML** for image classification, object detection, tabular classification/regression, and forecasting
- **Custom training** with TensorFlow, PyTorch, scikit-learn, XGBoost
- **Generative AI** via the Gemini API (Gemini 3.x, 2.5.x, 2.0.x)
- **Model Registry** for versioning, deploying, and managing model lifecycle
- **Experiments** for tracking ML training runs, metrics, and parameters
- **BigQuery ML** integration — train models using SQL without leaving BigQuery
- **Vertex AI TensorBoard** for time-series metrics visualization
- **Vertex AI Pipelines** for ML workflow orchestration
- **Vertex AI Vizier** for hyperparameter optimization
- **Vertex AI Feature Store** for feature management
- **Vertex AI Vector Search** for vector similarity search

**Key concept:** The platform has been consolidated under "Gemini Enterprise Agent Platform" but many SDK packages and APIs still reference `vertexai`.

---

## Vertex AI Datasets (Managed Datasets)

### Overview

Managed datasets provide source data for training AutoML and custom models. A managed dataset is **required for AutoML** and **optional for custom training**.

### Data Types Supported

| Data Type | AutoML Support | Custom Training |
|-----------|----------------|-----------------|
| Image (classification, object detection) | Yes | Yes |
| Tabular (classification, regression, forecasting) | Yes | Yes |
| Text | No | Yes |
| Video | Yes | Yes |

### Creating a Dataset

**Console:**
1. Go to Gemini Enterprise Agent Platform > Datasets
2. Click **Create**
3. Select data type and objective
4. Import data from Cloud Storage or your local machine
5. Configure data splits (for AutoML)

**API (Python SDK):**
```python
from google.cloud import aiplatform

dataset = aiplatform.ImageDataset.create(
    display_name="my-image-dataset",
    gcs_source=["gs://bucket/images.csv"],
    import_schema_uri=aiplatform.schema.dataset.ioformat.image.single_label_classification,
)
```

**Key concepts:**
- Data is typically sourced from **Cloud Storage** buckets
- Use **data splits** (training/validation/test) for AutoML models
- **Annotation sets** label your data (for supervised learning)
- **Knowledge Catalog** (replaces Data Catalog) provides metadata management across projects and regions
- Permissions require the **Agent Platform Service Agent** to access Cloud Storage data

### Importing Data

- Supported via CSV files pointing to Cloud Storage URIs
- Direct upload from local machine (console only, for smaller datasets)
- BigQuery tables can also be used as data sources
- Images, tabular CSVs, and text files supported

### Managing Datasets

- **Export** metadata and annotations
- **Label** data using the console
- **Version** image datasets (API only)
- **Delete** datasets and annotation sets
- View across projects using **Knowledge Catalog**

### Official Docs

- <https://docs.cloud.google.com/gemini-enterprise-agent-platform/machine-learning/datasets/overview>
- <https://docs.cloud.google.com/gemini-enterprise-agent-platform/machine-learning/datasets/data-splits>

---

## Vertex AI Experiments

### Overview

Vertex AI Experiments (now "Agent Platform Experiments") track and analyze different model architectures, hyperparameters, and training environments. It lets you track steps, inputs, outputs, metrics, and parameters of ML training runs.

**Key features:**
- Track **parameters** and **metrics** across experiment runs
- Compare model performance across multiple architectures
- Search experiments via console or Python SDK
- No **additional charges** for experiment runs — only pay for compute resources used
- Integrates with **Vertex AI TensorBoard** for time-series metrics
- Supports all Python ML frameworks (TensorFlow, PyTorch, scikit-learn, XGBoost)

### Core Concepts

| Term | Definition |
|------|------------|
| **Experiment** | A collection of related runs (e.g., "hyperparameter-tuning-v2") |
| **Experiment Run** | A single training attempt with a set of parameters and resulting metrics |
| **Pipeline Run** | A pipeline execution tracked as part of an experiment |
| **Parameters** | Input values for a run (e.g., learning_rate=0.001, batch_size=32) |
| **Metrics** | Output measurements (e.g., accuracy=0.95, loss=0.05) |
| **Artifacts** | Input/output artifacts consumed/produced by steps (e.g., models, datasets) |
| **Executions** | Individual steps in a pipeline run |

### Usage (Python SDK)

```python
from google.cloud import aiplatform

# Initialize experiment
aiplatform.init(
    project="my-project",
    location="us-central1",
    experiment="my-experiment"
)

# Start a run
with aiplatform.start_run(run="run-1") as my_run:
    # Log parameters
    aiplatform.log_params({
        "learning_rate": 0.001,
        "batch_size": 32,
        "epochs": 10
    })

    # ... training code ...

    # Log metrics
    aiplatform.log_metrics({
        "accuracy": 0.95,
        "loss": 0.05,
        "f1_score": 0.93
    })

    # Log a model
    aiplatform.log_model(
        model="models/my-model",
        uri="gs://model-bucket/my-model/"
    )
```

### Using Experiments with Custom Training

1. Create an experiment in the console or via SDK
2. Add experiment runs with parameters and metrics
3. Optionally link Cloud Logging logs to the experiment run
4. Compare runs side-by-side in the console
5. View **time-series metrics** via Vertex AI TensorBoard

### Data Models

Experiments follow the **ML Metadata** schema:
- An `Experiment` contains multiple `ExperimentRun`s
- Each `ExperimentRun` has `parameters`, `summary metrics`, `time series metrics`
- Linked to `Artifact`s (models, datasets) and `Execution`s (pipeline steps)
- Pipeline runs (`PipelineJob`) can be added to experiments

### Official Docs

- <https://docs.cloud.google.com/gemini-enterprise-agent-platform/machine-learning/experiments/intro-vertex-ai-experiments>
- <https://docs.cloud.google.com/gemini-enterprise-agent-platform/machine-learning/experiments/create-experiment>
- <https://docs.cloud.google.com/gemini-enterprise-agent-platform/machine-learning/experiments/runs>

---

## Gemini API on Vertex AI

### Overview

The Gemini API on Vertex AI provides access to Google's most capable generative AI models. It is accessed via the Agent Platform API (`aiplatform.googleapis.com`) and requires a GCP project with billing enabled.

### Available Models

#### Gemini 3 Family (Latest)
| Model | Description |
|-------|-------------|
| **Gemini 3.1 Pro Preview** | Most capable Gemini model; 2M token context; reasoning, multimodal |
| **Gemini 3.5 Flash** | Fast, cost-effective; multimodal; 1M token context |
| **Gemini 3 Flash Preview** | Budget-friendly; text/image/video input; 1M token context |
| **Gemini 3.1 Flash-Lite** | Lowest cost in Gemini 3 family; text/image/video input |
| **Gemini 3.1 Flash Image / Lite Image** | Image generation-capable variants |

#### Gemini Omni
| Model | Description |
|-------|-------------|
| **Gemini Omni Flash** | Multimodal with video output capability; text/image/video/audio input |

#### Gemini 2.5 Family
| Model | Description |
|-------|-------------|
| **Gemini 2.5 Pro** | Strong reasoning and coding; 1M token context |
| **Gemini 2.5 Flash** | Fast, cost-effective reasoning |
| **Gemini 2.5 Flash-Lite** | Lowest cost in 2.5 family |

#### Gemini 2.0 Family
| Model | Description |
|-------|-------------|
| **Gemini 2.0 Flash** | Fast performance for everyday tasks |
| **Gemini 2.0 Flash-Lite** | Lowest latency and cost |

### Accessing Gemini on Vertex AI

**Via the Gen AI SDK (`@google/genai`):**
```typescript
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({
  vertexai: true,
  project: 'my-project',
  location: 'us-central1',
});

const response = await ai.models.generateContent({
  model: 'gemini-3.1-flash-lite',
  contents: 'Explain how ML trains models.',
});
```

**Via the `@google-cloud/agentplatform` SDK:**
```typescript
import { Client } from '@google-cloud/agentplatform';

const client = new Client({
  project: 'my-project',
  location: 'us-central1',
});
```

**Via OpenAI-compatible libraries:**
- Access Gemini models using OpenAI client SDKs by pointing to the Agent Platform endpoint
- See: <https://docs.cloud.google.com/gemini-enterprise-agent-platform/machine-learning/openai>

### Setting Up

1. Create a GCP project
2. Enable billing
3. Enable the Agent Platform API (`aiplatform.googleapis.com`)
4. Install the gcloud CLI and authenticate
5. Install the SDK: `npm install @google-cloud/agentplatform` (or `@google/genai`)

```shell
gcloud auth application-default login
```

### Storing Gemini Reasoning Traces as Vertex AI Experiments

You can log Gemini model outputs, prompts, reasoning traces, and response metadata as Vertex AI Experiment runs. This allows side-by-side comparison of model responses, tracking prompt versions, and analyzing model behavior over time.

```python
from google.cloud import aiplatform
from google.genai import GoogleGenAI

aiplatform.init(project="my-project", experiment="gemini-evals")

genai = GoogleGenAI(vertexai=True, project="my-project", location="us-central1")

prompts = [
    "What are the top 5 crypto trends in 2026?",
    "Analyze Bitcoin price correlation with macro indicators",
]

for i, prompt in enumerate(prompts):
    with aiplatform.start_run(run=f"prompt-{i}") as run:
        aiplatform.log_params({"prompt": prompt, "model": "gemini-3.1-flash-lite"})

        response = genai.models.generate_content(
            model="gemini-3.1-flash-lite",
            contents=prompt,
        )

        aiplatform.log_metrics({
            "prompt_tokens": response.usage_metadata.prompt_token_count,
            "candidates_token_count": response.usage_metadata.candidates_token_count,
            "total_token_count": response.usage_metadata.total_token_count,
        })

        # Log the response text as an artifact or metric
        aiplatform.log_metrics({
            "response_length": len(response.text),
        })
```

---

## Vertex AI Model Registry

### Overview

The Model Registry is a central repository for managing the lifecycle of ML models. It provides:

- **Model versioning** — track iterations of a model
- **Aliases** — assign meaningful names to versions (e.g., "production", "staging")
- **Deployment** — deploy model versions directly to endpoints for online prediction
- **Evaluation** — evaluate model quality from the version details page
- **Batch inference** — set up batch predictions
- **BigQuery ML integration** — register BigQuery ML models without exporting
- **Knowledge Catalog** — discover models across projects and regions

### Supported Model Types

- AutoML models (tabular, image)
- Custom-trained models (TensorFlow, PyTorch, scikit-learn, XGBoost)
- BigQuery ML models
- Generative AI models

### Common Workflow

1. **Import or train a model** — from AutoML, custom training, or BigQuery ML
2. **Register the model** in the Model Registry
3. **Create versions** as the model evolves
4. **Assign aliases** (e.g., `production`, `staging`)
5. **Evaluate** model quality
6. **Deploy** to an endpoint for online predictions
7. **Monitor** model performance

### API Usage

```python
from google.cloud import aiplatform

model = aiplatform.Model.upload(
    display_name="my-model",
    artifact_uri="gs://model-bucket/my-model/",
    serving_container_image_uri="us-docker.pkg.dev/vertex-ai/prediction/tf2-cpu.2-12:latest",
)

# Deploy to endpoint
endpoint = model.deploy(
    machine_type="n1-standard-4",
    min_replica_count=1,
    max_replica_count=3,
)
```

### Official Docs

- <https://docs.cloud.google.com/gemini-enterprise-agent-platform/machine-learning/model-registry/introduction>
- <https://docs.cloud.google.com/gemini-enterprise-agent-platform/machine-learning/model-registry/versioning>
- <https://docs.cloud.google.com/gemini-enterprise-agent-platform/machine-learning/model-registry/import-models>
- <https://docs.cloud.google.com/gemini-enterprise-agent-platform/machine-learning/model-registry/aliases>

---

## BigQuery ML

### Overview

BigQuery ML (BQML) lets you create, train, and deploy ML models using **standard SQL** queries — no programming required. Models stay in BigQuery, and you can export them to the Vertex AI Model Registry for deployment at scale.

### Supported Model Types

| Model Type | SQL Syntax |
|------------|------------|
| Linear regression | `CREATE MODEL ... OPTIONS(model_type='linear_reg')` |
| Logistic regression | `CREATE MODEL ... OPTIONS(model_type='logistic_reg')` |
| Boosted tree (XGBoost) | `CREATE MODEL ... OPTIONS(model_type='boosted_tree_classifier')` |
| Random forest | `CREATE MODEL ... OPTIONS(model_type='random_forest_classifier')` |
| Deep neural network | `CREATE MODEL ... OPTIONS(model_type='dnn_classifier')` |
| K-means clustering | `CREATE MODEL ... OPTIONS(model_type='kmeans')` |
| Matrix factorization | `CREATE MODEL ... OPTIONS(model_type='matrix_factorization')` |
| Time series (ARIMA+) | `CREATE MODEL ... OPTIONS(model_type='arima_plus')` |
| PCA | `CREATE MODEL ... OPTIONS(model_type='pca')` |
| AutoML | `CREATE MODEL ... OPTIONS(model_type='automl_classifier')` |
| Imported TensorFlow models | `CREATE MODEL ... OPTIONS(model_type='tensorflow')` |
| Remote models (Gemini, Claude) | `CREATE MODEL ... OPTIONS(model_type='remote')` |

### Key Benefits

- **Train models without leaving BigQuery** — data never needs to move
- **SQL-based** — familiar to analysts and data engineers
- **Automatic data split** — BigQuery automatically splits data for training/evaluation
- **Hyperparameter tuning** — `CREATE MODEL` with `NUM_TRIALS` option
- **No export needed** to Vertex AI Model Registry — native integration
- **Free tier** — 1 TB of queries per month at no charge

### Example

```sql
CREATE OR REPLACE MODEL `my_dataset.my_model`
OPTIONS(
  model_type='logistic_reg',
  input_label_cols=['label'],
  auto_class_weights=TRUE
) AS
SELECT
  feature_1,
  feature_2,
  feature_3,
  label
FROM `my_dataset.training_data`
WHERE date < '2026-01-01';
```

### Pricing

- BigQuery ML training is billed per slot-hour
- BigQuery ML prediction is billed per query (data scanned)
- Free tier: 1 TB of query data processed per month at no charge
- ARIMA+ models: $250.00 per TB × number of candidate models × backtesting windows
- ARIMA+ predictions: $5.00 / 1,000 predictions

### Official Docs

- <https://docs.cloud.google.com/bigquery/docs/create-machine-learning-model>
- <https://docs.cloud.google.com/bigquery/docs/bigqueryml-overview>

---

## @google-cloud/vertexai npm Package

### Package Status

**⚠️ The package has been renamed.** The old `@google-cloud/vertexai` package (v1.12.0) is deprecated. The new package is `@google-cloud/agentplatform` (v0.10.0+).

| Package | Version | Status |
|---------|---------|--------|
| `@google-cloud/vertexai` | 1.12.0 | Deprecated |
| `@google-cloud/agentplatform` | 0.10.0+ | Current |

**GitHub repo:** <https://github.com/googleapis/nodejs-agentplatform>
(Formerly `googleapis/nodejs-vertexai`)

### Installation

```shell
npm install @google-cloud/agentplatform
```

### Usage

```typescript
import { Client } from '@google-cloud/agentplatform';

// Instantiate client
const client = new Client({
  project: 'my-cloud-project',
  location: 'us-central1',
});

// Create a prompt
const prompt = {
  promptData: {
    contents: [{ parts: [{ text: 'Hello, {name}! How are you?' }] }],
    systemInstruction: { parts: [{ text: 'Answer concisely.' }] },
    variables: [{ name: { text: 'Alice' } }],
    model: 'gemini-3.1-flash-lite',
  },
};

const promptResource = await client.prompts.createVersion({ prompt });

// Generate content using the Gen AI SDK
import { GoogleGenAI } from '@google/genai';

const genai = new GoogleGenAI({
  vertexai: true,
  project: 'my-project',
  location: 'us-central1',
});

const response = await genai.models.generateContent({
  model: 'gemini-3.1-flash-lite',
  contents: 'Hello world',
});
```

### Requirements

- Node.js 22+
- GCP project with billing enabled
- Agent Platform API enabled
- Application Default Credentials configured (`gcloud auth application-default login`)

---

## Pricing & Free Tier

### Google Cloud Free Trial

| Offer | Details |
|-------|---------|
| **$300 Welcome Credit** | Free for 90 days for new customers |
| **Free Trial** | 90-day program, no automatic billing |
| **20+ Free Tier products** | Monthly usage allowances that never expire |

### Free Tier Products (Relevant to Vertex AI)

| Product | Free Tier Limit |
|---------|----------------|
| **BigQuery** | 1 TB of queries per month |
| **Cloud Storage** | 5 GB-months of Standard Storage |
| **Cloud Run** | 2 million requests per month |
| **Cloud Run functions** | 2 million invocations per month |
| **Compute Engine** | 1 e2-micro instance per month |
| **Vertex AI Experiments** | No additional charges — only pay for compute resources used |
| **Vision AI** | 1,000 units per month |
| **Natural Language API** | 5,000 units per month |
| **Speech-to-Text** | 60 minutes per month |
| **Video Intelligence** | 1,000 units per month |

### Gemini API Pricing (Standard Tier)

**Gemini 3 Family** (per 1M tokens):

| Model | Input (≤200K) | Input (>200K) | Output | Cached Input |
|-------|--------------|---------------|--------|-------------|
| **Gemini 3.1 Pro Preview** | $2.00 | $4.00 | $12.00 | $0.20 |
| **Gemini 3.5 Flash** | $1.50 | $1.50 | $9.00 | $0.15 |
| **Gemini 3 Flash Preview** | $0.50 | $0.50 | $3.00 | $0.05 |
| **Gemini 3.1 Flash-Lite** | $0.25 | $0.25 | $1.50 | $0.025 |
| **Gemini 3.1 Flash-Lite Image** | $0.25 | N/A | $1.50 | N/A |
| **Gemini 3.1 Flash Image** | $0.50 | N/A | $3.00 | N/A |

**Gemini Omni**:
| Model | Input | Text Output | Video Output |
|-------|-------|-------------|-------------|
| **Gemini Omni Flash** | $1.50/1M | $9.00/1M | $0.10/s |

**Gemini 2.5 Family** (see pricing page for current rates)

### Key Pricing Notes

- Only requests returning HTTP 200 are charged
- **Grounding with Google Search**: 5,000 search queries/month free (Gemini 3 models), then $14/1K queries
- **Tuned models**: For Gemini 3+, tuned endpoint is 1.5× the base model price
- **Model Tuning**: ~$3–$10 per 1M training tokens depending on model
- **Experiments**: No separate charge — pay only for underlying compute
- **Experiment runs do not incur additional charges** beyond the compute resources used

### Official Pricing Pages

- **Generative AI (Gemini) pricing:** <https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing>
- **ML Platform pricing:** <https://cloud.google.com/products/gemini-enterprise-agent-platform/pricing>
- **Free Tier details:** <https://cloud.google.com/free>
- **Free Program docs:** <https://docs.cloud.google.com/free/docs/free-cloud-features>

---

## Links & References

### Official Documentation
- Platform overview: <https://docs.cloud.google.com/gemini-enterprise-agent-platform/machine-learning>
- Datasets: <https://docs.cloud.google.com/gemini-enterprise-agent-platform/machine-learning/datasets/overview>
- Experiments: <https://docs.cloud.google.com/gemini-enterprise-agent-platform/machine-learning/experiments/intro-vertex-ai-experiments>
- Model Registry: <https://docs.cloud.google.com/gemini-enterprise-agent-platform/machine-learning/model-registry/introduction>
- BigQuery ML: <https://cloud.google.com/bigquery/docs/introduction>
- Gemini Models: <https://cloud.google.com/vertex-ai/docs/generative-ai/learn/models#gemini-models>
- Pricing (Gen AI): <https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing>
- Pricing (ML Platform): <https://cloud.google.com/products/gemini-enterprise-agent-platform/pricing>

### SDK & Libraries
- npm: `@google-cloud/agentplatform` — <https://www.npmjs.com/package/@google-cloud/agentplatform>
- npm: `@google-cloud/vertexai` (deprecated) — <https://www.npmjs.com/package/@google-cloud/vertexai>
- npm: `@google/genai` — Gen AI SDK for Node.js
- GitHub: <https://github.com/googleapis/nodejs-agentplatform>
- Python: `google-cloud-aiplatform` — <https://pypi.org/project/google-cloud-aiplatform/>

### Quickstarts
- Get started with Gemini 3: <https://docs.cloud.google.com/gemini-enterprise-agent-platform/machine-learning/gemini-3>
- Gen AI SDK: <https://docs.cloud.google.com/gemini-enterprise-agent-platform/machine-learning/genai-sdk>
- Node.js quickstart: <https://github.com/googleapis/nodejs-agentplatform>

---

*Last updated: July 2026.*
*Sources: Official GCP documentation at cloud.google.com and docs.cloud.google.com.*
