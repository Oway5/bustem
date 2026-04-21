import type {
  Marketplace,
  NormalizedListing,
  Result,
  SaleFormat,
} from "@/lib/types";
import { RequestBudget } from "@/lib/budget";

const DEFAULT_API_KEY = "4558fb24345f6ac0aa999ef5d14f5ea9";

export const SEARCH_QUERIES = [
  "comfrt hoodie",
  "comfrt travel hoodie",
  "comfrt minimalist hoodie",
  "comfrt signature hoodie",
  "comfrt pastel hoodie",
];

export function getScraperApiKey() {
  return process.env.SCRAPER_API_KEY || DEFAULT_API_KEY;
}

function buildUrl(marketplace: Marketplace, query: string, page: number) {
  const apiKey = getScraperApiKey();
  const encodedQuery = encodeURIComponent(query);

  if (marketplace === "amazon") {
    return `https://api.scraperapi.com/structured/amazon/search/v1?api_key=${apiKey}&query=${encodedQuery}&tld=com&page=${page}`;
  }

  return `https://api.scraperapi.com/structured/ebay/search?api_key=${apiKey}&query=${encodedQuery}&page=${page}`;
}

function parseNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.replace(/[^0-9.]/g, "");
    if (!normalized) {
      return null;
    }

    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseShippingPrice(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.toLowerCase();
  if (normalized.includes("free")) {
    return 0;
  }

  return parseNumber(value);
}

function parseEbayItemId(url: string) {
  const match = url.match(/\/itm\/(\d+)/);
  return match?.[1] ?? null;
}

function inferSaleFormat(extraInfo: string | null): SaleFormat {
  if (!extraInfo) {
    return "unknown";
  }

  const normalized = extraInfo.toLowerCase();
  if (
    normalized.includes("buy it now") ||
    normalized.includes("best offer")
  ) {
    return "fixed";
  }

  if (normalized.includes("auction") || normalized.includes("bid")) {
    return "auction";
  }

  return "unknown";
}

function normalizeAmazonResults(
  payload: { results?: Array<Record<string, unknown>> },
  query: string,
  page: number,
) {
  return (payload.results ?? [])
    .map((item) => {
      const id = typeof item.asin === "string" ? item.asin : null;
      const title = typeof item.name === "string" ? item.name : null;
      const url = typeof item.url === "string" ? item.url : null;

      if (!id || !title || !url) {
        return null;
      }

      const price = parseNumber(item.price);
      const result: NormalizedListing = {
        id,
        marketplace: "amazon",
        title,
        url,
        imageUrl: typeof item.image === "string" ? item.image : null,
        price,
        shippingPrice: null,
        totalPrice: price,
        condition: "New",
        queries: [query],
        seenIn: [{ query, page }],
        shortlisted: false,
        score: 0,
        signals: [],
        topReasons: [],
        scoredAt: 0,
        saleFormat: "fixed",
      };

      return result;
    })
    .filter((item): item is NormalizedListing => item !== null);
}

function normalizeEbayResults(
  payload: Array<Record<string, unknown>>,
  query: string,
  page: number,
) {
  return payload
    .map((item) => {
      const url = typeof item.product_url === "string" ? item.product_url : null;
      const title =
        typeof item.product_title === "string" ? item.product_title : null;
      const id = url ? parseEbayItemId(url) : null;

      if (!id || !title || !url) {
        return null;
      }

      const itemPrice =
        typeof item.item_price === "object" && item.item_price
          ? (item.item_price as {
              value?: unknown;
              from?: { value?: unknown };
              to?: { value?: unknown };
            })
          : null;

      const price =
        parseNumber(itemPrice?.value) ??
        parseNumber(itemPrice?.from?.value) ??
        parseNumber(itemPrice?.to?.value);
      const shippingPrice = parseShippingPrice(item.shipping_cost);
      const totalPrice =
        price !== null && shippingPrice !== null ? price + shippingPrice : price;

      const extraInfo =
        typeof item.extra_info === "string" ? item.extra_info : null;

      const result: NormalizedListing = {
        id,
        marketplace: "ebay",
        title,
        url,
        imageUrl: typeof item.image === "string" ? item.image : null,
        price,
        shippingPrice,
        totalPrice,
        condition: typeof item.condition === "string" ? item.condition : null,
        queries: [query],
        seenIn: [{ query, page }],
        shortlisted: false,
        score: 0,
        signals: [],
        topReasons: [],
        scoredAt: 0,
        saleFormat: inferSaleFormat(extraInfo),
      };

      return result;
    })
    .filter((item): item is NormalizedListing => item !== null);
}

export async function fetchMarketplacePage(params: {
  marketplace: Marketplace;
  query: string;
  page: number;
  budget: RequestBudget;
  signal: AbortSignal;
}) {
  const { marketplace, query, page, budget, signal } = params;

  if (!budget.reserve(marketplace)) {
    return {
      skipped: true,
      marketplace,
      page,
      query,
      results: [] as NormalizedListing[],
      reason: "Request budget exhausted before dispatch.",
    };
  }

  const response = await fetch(buildUrl(marketplace, query, page), {
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new Error(
      `${marketplace} page ${page} for "${query}" failed with ${response.status}`,
    );
  }

  const payload = (await response.json()) as
    | { results?: Array<Record<string, unknown>> }
    | Array<Record<string, unknown>>;

  const results =
    marketplace === "amazon"
      ? normalizeAmazonResults(
          payload as { results?: Array<Record<string, unknown>> },
          query,
          page,
        )
      : normalizeEbayResults(payload as Array<Record<string, unknown>>, query, page);

  return {
    skipped: false,
    marketplace,
    page,
    query,
    results,
  };
}

export function mergeListing(existing: Result, incoming: Result) {
  existing.queries = Array.from(new Set([...existing.queries, ...incoming.queries]));

  const seenInKeys = new Set(existing.seenIn.map((item) => `${item.query}:${item.page}`));
  for (const sighting of incoming.seenIn) {
    const key = `${sighting.query}:${sighting.page}`;
    if (!seenInKeys.has(key)) {
      existing.seenIn.push(sighting);
      seenInKeys.add(key);
    }
  }

  return existing;
}
