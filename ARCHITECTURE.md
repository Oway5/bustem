# Multi-Tenant Evolution

## Job orchestration

Move the current in-request pipeline to a queue-backed model:

- API layer accepts a job request, validates tenant + search profile, and writes a `job` row.
- A scheduler fans the work into queue messages by marketplace/query/page and by downstream enrichment stage.
- Stateless workers consume those messages for scraping, scoring, OCR/image work, and result aggregation.
- A result-stream service pushes progress to clients over SSE or websockets from persisted job state rather than from a long-lived HTTP request.

This keeps the user-facing API fast while letting the system run many concurrent jobs without tying work to a single web server instance.

## Rate limiting and client isolation

- Maintain per-tenant quotas for daily jobs, concurrent jobs, and external-request budgets.
- Enforce marketplace-specific concurrency pools so one noisy tenant cannot starve others.
- Use tenant-scoped priority queues with weighted fair scheduling.
- Keep reference datasets, scoring configs, and alert thresholds tenant-specific so each client can tune recall vs precision independently.

## Data model

Store:

- `tenants`: config, allowed marketplaces, quotas, billing plan
- `reference_sets`: product metadata, image hashes, embeddings, version history
- `jobs`: lifecycle state, time range, request counts, elapsed time, failure summary
- `job_tasks`: per-stage task attempts, latency, retry count, error payloads
- `results`: normalized listings, dedupe keys, scores, explanations, final ranking
- `artifacts`: raw scraper payloads, fetched images, OCR text, model outputs

Persisting artifacts makes audits and scoring-regression work practical.

## Retry and failure handling

- Retry transient marketplace/network failures with exponential backoff and jitter.
- Retry expensive enrichment separately from scraping so partial results remain usable.
- Mark each signal independently as missing when a downstream dependency fails.
- Use dead-letter queues for repeated failures and surface them in operator tooling.
- Expire stuck jobs with heartbeat monitoring and allow safe stage-level replays from persisted artifacts.

## Observability

Track:

- job throughput and time-to-first-result
- per-marketplace request volume, latency, and failure rate
- per-tenant queue depth and worker utilization
- signal availability rate and score distributions
- dedupe rate, shortlist size, and image-enrichment hit rate
- false-positive / false-negative review feedback where human labeling exists

Use distributed traces keyed by `tenant_id` and `job_id` so one investigation can follow a listing from scrape to final score.
