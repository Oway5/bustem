# Fixtures

Saved ScraperAPI responses captured during development so we can exercise the
normalization and scoring pipeline offline without burning live requests.

- `amazon-search-comfrt-hoodie-page1.json` / `page2.json` — Amazon structured
  search responses for the query `comfrt hoodie`.
- `ebay-search-comfrt-hoodie-page1.json` / `page2.json` — eBay structured
  search responses for the same query.

These are not wired into the app; they exist as reference payloads for manual
debugging and for sketching future unit tests of `src/lib/scraper.ts`.
