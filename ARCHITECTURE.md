# Multi-Tenant Evolution

The prototype runs the entire scrape → score → image pipeline inside one Next.js route handler. A production deployment needs to break that apart along natural queue boundaries, isolate tenants, and persist artifacts for audits.

## Job orchestration

- API layer (stateless, behind ALB): accepts a job request, validates tenant + search profile, writes a `jobs` row, and returns a job id plus an SSE subscription URL.
- Per-stage **SQS FIFO queues** keyed by `tenant_id` for fair scheduling: `scrape`, `coarse-score`, `image-enrich`, `result-aggregate`. FIFO + `MessageGroupId = tenant_id` guarantees per-tenant ordering and naturally caps per-tenant in-flight work.
- The `scrape` stage specifically uses a **standard (non-FIFO) SQS queue** with a small tenant-scoped dispatcher Lambda that enforces a global ScraperAPI concurrency limit; scrape work is embarrassingly parallel within a tenant, but must not burst past the account-level external rate budget.
- Stateless Node workers on **AWS Fargate**, one task definition per stage. Scrape workers are sized for I/O (low CPU, high network); enrichment workers are sized for the DCT + embedding work (higher CPU, optional GPU pool if/when we move to CLIP).
- A result-stream service (single SSE endpoint backed by Postgres LISTEN/NOTIFY) pushes progress from persisted job state instead of from a long-lived HTTP request, so the UI survives API pod restarts.

## Rate limiting and client isolation

- Per-tenant quotas enforced at the API layer: daily jobs, concurrent jobs, total monthly external-request budget. Quotas live in `tenants.quotas` and are checked transactionally against `jobs` + a Redis-backed per-tenant token bucket.
- Separate worker pools per stage so ScraperAPI backpressure (429/503) cannot starve OCR or image-hash work for other tenants.
- Tenant-scoped priority queues with weighted fair scheduling on the dispatcher — free-tier tenants get a fixed slice of the concurrency pool, paid tiers get weighted shares.
- Reference datasets, scoring weights, signal availability, and alert thresholds are all tenant-scoped rows in `reference_sets` + `scoring_configs`, so each client can tune recall vs precision independently without code changes.

## Data model

Postgres (RDS, `tenant_id` as the first partition key on every table):

- `tenants`: config, allowed marketplaces, quotas, billing plan.
- `reference_sets`: `(tenant_id, version)` product metadata, image hashes, optional CLIP embeddings, activation history.
- `jobs`: lifecycle state machine (`queued → scraping → coarse → image → done | failed`), time range, request counts, elapsed time, failure summary.
- `job_tasks`: per-stage task attempts, latency, retry count, error payloads; primary key `(job_id, stage, attempt_no)`.
- `results`: normalized listings keyed by `(tenant_id, marketplace, listing_id)`, with scores, signal breakdown JSONB, and a shortlisted flag.

Artifact storage in S3 under `s3://bustem-artifacts/<tenant_id>/<job_id>/<stage>/`:

- raw ScraperAPI JSON payloads (`scrape/<query>-<marketplace>-p<page>.json`)
- fetched listing images (`images/<marketplace>:<id>.<ext>`)
- OCR output and model activations when we add them

Persisting artifacts makes scoring-regression work (replay yesterday's job with today's weights) and audits both cheap.

## Idempotency

- Dedup key per stage task is deterministic:
  - scrape: `(job_id, marketplace, query, page)`
  - image: `(job_id, marketplace, listing_id)`
- Workers `INSERT ... ON CONFLICT DO NOTHING` into `job_tasks` with that key before doing work, so an SQS redelivery after a worker crash is a no-op.

## Retry and failure handling

- Exponential backoff with full jitter inside each worker, same shape as `src/lib/retry.ts` but at the worker level so transient SQS + marketplace failures don't burn retries against each other.
- SQS `maxReceiveCount = 5`; after 5 attempts a message goes to a per-stage DLQ with an operator dashboard that can replay from artifact storage (the raw payload is already in S3).
- Mark each signal independently as missing when a downstream dependency fails. Per-signal failure does not fail the result; per-result failure does not fail the job.
- Stuck-job sweeper: a cron checks `jobs` for rows with no heartbeat in > 10 minutes and transitions them to `failed` with a replayable marker.

## Observability

**Datadog** for traces and metrics; traces keyed by `tenant_id` and `job_id` so one investigation can follow a listing from scrape to final score.

Golden metrics:

- **Time-to-first-result p50 / p95** per tenant. Latency SLO lives here.
- **Per-tenant ScraperAPI spend** (requests/day, cost/day) to enforce budget alerts and detect runaway jobs.
- **Signal availability rate** per signal — a sudden drop in `price.available` usually means marketplace schema drift.
- **Shortlist hit rate**: of the top-K shortlisted listings, what fraction ends up scoring above the "likely infringement" threshold after image enrichment. Drops here are the early signal that coarse scoring needs retuning.
- **DLQ depth** and **retry rate** per stage as leading indicators of upstream breakage.
- **Dedupe rate** (listings collapsed / raw listings scraped) as a cheap sanity check on the scraper normalizer.

Human-labeling feedback (false positive / false negative rates from reviewer tools) feeds back into tenant-scoped score threshold tuning.
