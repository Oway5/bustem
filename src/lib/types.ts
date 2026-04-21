export type Marketplace = "amazon" | "ebay";

export type SignalName = "brandCue" | "title" | "price" | "phash";

export type Signal = {
  name: SignalName;
  score: number;
  weight: number;
  contribution: number;
  available: boolean;
  reason: string;
  raw: Record<string, unknown>;
};

export type SeenIn = {
  query: string;
  page: number;
};

export type Result = {
  id: string;
  marketplace: Marketplace;
  title: string;
  url: string;
  imageUrl: string | null;
  price: number | null;
  shippingPrice: number | null;
  totalPrice: number | null;
  condition: string | null;
  queries: string[];
  seenIn: SeenIn[];
  shortlisted: boolean;
  score: number;
  signals: Signal[];
  topReasons: string[];
  scoredAt: number;
};

export type RequestsByPlatform = {
  amazon: number;
  ebay: number;
  images: number;
  total: number;
};

export type StatusEvent = {
  type: "status";
  phase: "scraping" | "cheap-scoring" | "image-scoring" | "done";
  elapsedMs: number;
  requests: RequestsByPlatform;
  budget: { used: number; remaining: number; cap: number };
  pagesFetched: number;
  uniqueResults: number;
  shortlistedCount: number;
};

export type ResultEvent = {
  type: "result";
  data: Result;
};

export type DoneEvent = {
  type: "done";
};

export type ErrorEvent = {
  type: "error";
  message: string;
  fatal: boolean;
};

export type StreamEvent = StatusEvent | ResultEvent | DoneEvent | ErrorEvent;

export type ReferenceItem = {
  id: string;
  title: string;
  category: string;
  url: string;
  imageUrl: string;
  imagePath: string;
  minPrice: number | null;
  maxPrice: number | null;
  medianPrice: number | null;
  phash: string | null;
};

export type NormalizedListing = Result & {
  coarseScore?: number;
  matchReferenceId?: string | null;
  matchReferenceTitle?: string | null;
  fixedPrice: boolean;
};
