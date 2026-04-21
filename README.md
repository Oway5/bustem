# Bustem Take-Home

This is a Next.js App Router app that simulates a simplified infringement-detection pipeline for suspicious Comfrt listings on Amazon and eBay.

## What it does

- Starts a search job from the UI.
- Runs 5 Comfrt hoodie query variants across Amazon and eBay.
- Fetches up to 2 pages per query per marketplace.
- Deduplicates by `amazon:ASIN` and `ebay:itemId`.
- Streams coarse-scored results progressively over NDJSON from `/api/search` as scrape pages complete.
- Scores every listing with 4 explainable signals:
  - `brandCue`
  - `title`
  - `price`
  - `phash` (a pHash + aHash + dHash ensemble under the hood)
- Applies image similarity only to a bounded shortlist, then upserts the stronger result back into the UI.

## Stack

- Next.js 16 App Router
- Route Handler streaming `application/x-ndjson`
- Local reference set built from the live Comfrt hoodies collection plus downloaded images
- `sharp` for perceptual hashing

## Local setup

Requires Node 20+ (Next.js 16 requirement).

```bash
npm install
npm run dev
```

Open http://localhost:3000 and click "Start Search Job". The reference images and precomputed hashes in `data/reference/` are committed, so nothing else is required to run the app.

`npm run build:reference` is optional and only needed to refresh the reference set. It downloads the selected reference images from the live Comfrt collection page, refreshes `data/reference/images/`, and rewrites `data/reference/reference.json`.

The app works with the take-home ScraperAPI key by default. To override it:

```bash
SCRAPER_API_KEY=your_key_here
```

On Windows PowerShell:

```powershell
$env:SCRAPER_API_KEY="your_key_here"
```

## Pipeline notes

### Query set

- `comfrt hoodie`
- `comfrt travel hoodie`
- `comfrt minimalist hoodie`
- `comfrt signature hoodie`
- `comfrt pastel hoodie`

### Shared request budget

- Single soft cap of `120` external requests.
- Scraper and image fetches both reserve from the same budget before dispatch.
- Retries do not double-count against the budget: a 503 that succeeds on attempt 2 costs one slot, not two.
- Current concurrency (all overridable via env, see `.env.example`):
  - scraper requests: `5` (`BUSTEM_SCRAPER_CONCURRENCY`)
  - image fetches: `6` (`BUSTEM_IMAGE_CONCURRENCY`)
  - total budget cap: `120` (`BUSTEM_BUDGET_CAP`)
  - shortlist cap: `30` (`BUSTEM_MAX_SHORTLIST`)

### Scoring formula

Only available signals participate in the denominator:

```txt
finalScore = sum(weight * score) / sum(weight for available signals)
```

Current weights:

- `brandCue`: `0.15`
- `title`: `0.30`
- `price`: `0.20`
- `phash`: `0.35`

### Shortlist policy

- Every deduplicated result gets cheap scoring first.
- The app then takes the top `30` coarse-scored results, further capped by remaining request budget.
- Non-shortlisted results are explicitly marked with a missing `phash` signal and reason `Below the shortlist cutoff for image scoring.`

### Explainability

Each result exposes:

- final probability score
- top reasons
- signal score, weight, contribution, availability, reason
- raw values for every signal (the `phash` signal surfaces pHash/aHash/dHash distances plus which hash kind produced the best match)

## Known trade-offs

A few decisions that were made deliberately rather than by accident:

### Why only 4 signals

The four we have (`brandCue`, `title`, `price`, `phash`) are the cheapest signals with the highest marginal precision. A 5th signal would most plausibly be one of:

- **Seller/brand field on Amazon**: scrape the listing page to read the seller or "Brand:" row; heavily penalize anything that isn't the real Comfrt storefront. This is the single highest-value next signal for Amazon, but it doubles the per-result request cost.
- **OCR for "COMFRT" on the garment image**: Tesseract or a hosted OCR call on the primary image; a real Comfrt hoodie's embroidered logo is a strong positive signal.
- **CLIP / OpenCLIP embedding** replacing the hash ensemble: embedding cosine similarity is dramatically more robust to crop, rotation, watermarks, and background swaps than any Hamming-based hash. The tradeoff is ~50x latency and a model-hosting dependency, which is why the ensemble lives in-process for the take-home.

### Why `price` is often `available: false`

The scoring formula already excludes unavailable signals from the denominator, so marking `price` unavailable is *not* the same as giving it a zero. This is preferred over faking a neutral score: "`new (other)`", "`used`", "`refurbished`", auction listings, and Comfrt-adjacent items that don't match a reference title all legitimately have no comparable reference price. Scoring them as `0.5` would create false signal.

### Why image scoring is phase-gated

Image hashing costs a second network round-trip per shortlisted listing and ~30–60 ms of CPU for the DCT. Today we run the full scrape, then coarse-score, then shortlist, then hash. This is simple and correct but leaves latency on the table: the top shortlist entries are usually known by the time the second scrape batch completes. The right evolution is to pipeline image work as soon as the top-K coarse ranking stabilizes (watermarked by a "ranking stable for N events" heuristic), streaming enriched results to the UI progressively. That's not in scope here because it makes the reasoning about budget reservation and result upserts more subtle.

### Why dedup is `(marketplace, id)` only

Amazon ASINs and eBay item IDs are authoritative within their marketplace, so exact-id dedup is both cheap and correct. We deliberately do *not* dedup *across* marketplaces or across sellers by image-hash in this version. An image-hash cross-seller dedup pass would belong right after image scoring, using the same pHash/dHash we already compute to collapse duplicate drop-shipped listings; it would feed a "likely same garment" cluster view rather than dropping rows.

### Why retries are shallow (2–3 attempts)

ScraperAPI's transient failure modes are mostly 429/503, which resolve in ≤1 s. Three attempts with jittered backoff recovers nearly all of them within the per-job latency envelope the UI expects. We did not implement a circuit breaker because per-job isolation already bounds blast radius: a persistently-broken ScraperAPI upstream surfaces as a non-fatal `ErrorEvent` per query per page and the user sees partial results. In a multi-tenant deployment (see `ARCHITECTURE.md`) a breaker would live at the worker-pool level, not inside the route handler.

## Project structure

```txt
src/app/page.tsx              client UI and NDJSON stream consumer
src/app/api/search/route.ts   search orchestration and streaming route
src/lib/scraper.ts            ScraperAPI requests and result normalization
src/lib/budget.ts             shared request budget accounting
src/lib/retry.ts              transient-failure retry + backoff helper
src/lib/reference.ts          local reference loading
src/lib/scoring/*             signal implementations and score recomputation
scripts/build-reference.ts    builds data/reference/reference.json
data/reference/               local authentic reference set
__fixtures__/                 saved marketplace responses for debugging
```

## Checks run

- `npm run build:reference`
- `npm run lint`
- `npm run build`

`next build` succeeds. Turbopack still emits a non-blocking NFT tracing warning for the route because it reads local reference artifacts from disk at runtime.
