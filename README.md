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
  - `phash`
- Applies image similarity only to a bounded shortlist, then upserts the stronger result back into the UI.

## Stack

- Next.js 16 App Router
- Route Handler streaming `application/x-ndjson`
- Local reference set built from the live Comfrt hoodies collection plus downloaded images
- `sharp` for perceptual hashing

## Local setup

```bash
npm install
npm run build:reference
npm run dev
```

`npm run build:reference` downloads the selected reference images from the live Comfrt collection page, refreshes `data/reference/images/`, and rewrites `data/reference/reference.json`.

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
- Current concurrency:
  - scraper requests: `5`
  - image fetches: `6`

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
- raw values for every signal

## Project structure

```txt
src/app/page.tsx              client UI and NDJSON stream consumer
src/app/api/search/route.ts   search orchestration and streaming route
src/lib/scraper.ts            ScraperAPI requests and result normalization
src/lib/budget.ts             shared request budget accounting
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
