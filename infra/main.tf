terraform {
  required_version = ">= 1.3.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 4.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

variable "project_id" {
  type        = string
  description = "Google Cloud Project ID"
  default     = "project-513b86da-a04a-494a-8e9"
}

variable "region" {
  type        = string
  description = "Google Cloud region"
  default     = "us-central1"
}

# ── Pub/Sub Topics ──

resource "google_pubsub_topic" "events" {
  name = "crypto-radar-events"
}

# ── Cloud Tasks Queues ──

resource "google_cloud_tasks_queue" "gemini_analysis" {
  name     = "crypto-radar-gemini-analysis"
  location = var.region

  rate_limits {
    max_concurrent_dispatches = 1
    max_dispatches_per_second = 1.0
  }

  retry_config {
    max_attempts       = 3
    min_backoff        = "5s"
    max_backoff        = "60s"
    max_doublings      = 4
    max_retry_duration = "300s"
  }
}

resource "google_cloud_tasks_queue" "paper_trade" {
  name     = "crypto-radar-paper-trade"
  location = var.region

  rate_limits {
    max_concurrent_dispatches = 5
    max_dispatches_per_second = 10.0
  }

  retry_config {
    max_attempts = 5
  }
}

resource "google_cloud_tasks_queue" "model_retrain" {
  name     = "crypto-radar-model-retrain"
  location = var.region

  rate_limits {
    max_concurrent_dispatches = 1
    max_dispatches_per_second = 0.1
  }

  retry_config {
    max_attempts = 1
  }
}

# ── Storage Bucket for SQLite Backups ──

resource "google_storage_bucket" "state_bucket" {
  name          = "crypto-radar-storage-${var.project_id}"
  location      = "US"
  force_destroy = false

  versioning {
    enabled = true
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      num_newer_versions = 3
    }
  }
}
