import { createLimiter } from "@/lib/limit";
import { loadReferenceSet } from "@/lib/reference";
import {
  applyCheapSignals,
  computeFinalScore,
  markWithoutImageScore,
  topReasons,
} from "@/lib/scoring";
import {
  computeImageHashes,
  scorePhashSimilarity,
  unavailablePhashSignal,
} from "@/lib/scoring/phash";
import { fetchMarketplacePage, mergeListing, SEARCH_QUERIES } from "@/lib/scraper";
import type { NormalizedListing, StreamEvent } from "@/lib/types";
import { RequestBudget } from "@/lib/budget";
import { HttpStatusError, withRetry } from "@/lib/retry";

export const runtime = "nodejs";

function envNumber(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const BUDGET_CAP = envNumber("BUSTEM_BUDGET_CAP", 120);
const SCRAPER_CONCURRENCY = envNumber("BUSTEM_SCRAPER_CONCURRENCY", 5);
const IMAGE_CONCURRENCY = envNumber("BUSTEM_IMAGE_CONCURRENCY", 6);
const MAX_SHORTLIST = envNumber("BUSTEM_MAX_SHORTLIST", 30);

function serialize(event: StreamEvent) {
  return `${JSON.stringify(event)}\n`;
}

function elapsedSince(startedAt: number) {
  return Date.now() - startedAt;
}

function createStatusEvent(params: {
  phase: "scraping" | "cheap-scoring" | "image-scoring" | "done";
  startedAt: number;
  budget: RequestBudget;
  pagesFetched: number;
  uniqueResults: number;
  shortlistedCount: number;
}): StreamEvent {
  const snapshot = params.budget.snapshot();

  return {
    type: "status",
    phase: params.phase,
    elapsedMs: elapsedSince(params.startedAt),
    requests: snapshot.requests,
    budget: {
      used: snapshot.used,
      remaining: snapshot.remaining,
      cap: snapshot.cap,
    },
    pagesFetched: params.pagesFetched,
    uniqueResults: params.uniqueResults,
    shortlistedCount: params.shortlistedCount,
  };
}

function ensureActive(signal: AbortSignal) {
  if (signal.aborted) {
    throw new Error("Search aborted by client.");
  }
}

async function fetchImageBuffer(
  imageUrl: string,
  budget: RequestBudget,
  signal: AbortSignal,
) {
  if (!budget.reserve("images")) {
    throw new Error("Image request skipped because the request budget is exhausted.");
  }

  // Budget reserved once outside withRetry so a transient image CDN hiccup
  // doesn't burn the shared per-job request cap.
  return withRetry(
    async () => {
      const response = await fetch(imageUrl, { cache: "no-store", signal });
      if (!response.ok) {
        throw new HttpStatusError(
          response.status,
          `Image fetch failed with ${response.status}`,
        );
      }

      return Buffer.from(await response.arrayBuffer());
    },
    { signal, attempts: 2, baseMs: 250 },
  );
}

export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(serialize(event)));
      };

      const startedAt = Date.now();
      const budget = new RequestBudget(BUDGET_CAP);
      let pagesFetched = 0;
      let shortlistedCount = 0;

      try {
        const references = await loadReferenceSet();
        const listings = new Map<string, NormalizedListing>();
        let coarseScoredCount = 0;
        let lastCheapScoreStatusCount = 0;

        emit(
          createStatusEvent({
            phase: "scraping",
            startedAt,
            budget,
            pagesFetched,
            uniqueResults: listings.size,
            shortlistedCount,
          }),
        );

        const scrapeLimit = createLimiter(SCRAPER_CONCURRENCY);
        const scrapeTasks = SEARCH_QUERIES.flatMap((query) =>
          (["amazon", "ebay"] as const).flatMap((marketplace) =>
            [1, 2].map((page) =>
              scrapeLimit(async () => {
                ensureActive(request.signal);

                try {
                  const batch = await fetchMarketplacePage({
                    marketplace,
                    query,
                    page,
                    budget,
                    signal: request.signal,
                  });

                  if (!batch.skipped) {
                    pagesFetched += 1;
                  }

                  for (const listing of batch.results) {
                    const key = `${listing.marketplace}:${listing.id}`;
                    const existing = listings.get(key);

                    if (existing) {
                      mergeListing(existing, listing);
                      applyCheapSignals(existing, references);
                      emit({ type: "result", data: existing });
                    } else {
                      applyCheapSignals(listing, references);
                      listings.set(key, listing);
                      emit({ type: "result", data: listing });
                      coarseScoredCount += 1;
                    }
                  }

                  emit(
                    createStatusEvent({
                      phase: "scraping",
                      startedAt,
                      budget,
                      pagesFetched,
                      uniqueResults: listings.size,
                      shortlistedCount,
                    }),
                  );

                  if (coarseScoredCount >= lastCheapScoreStatusCount + 10) {
                    lastCheapScoreStatusCount = coarseScoredCount;
                    emit(
                      createStatusEvent({
                        phase: "cheap-scoring",
                        startedAt,
                        budget,
                        pagesFetched,
                        uniqueResults: listings.size,
                        shortlistedCount,
                      }),
                    );
                  }

                  if (batch.skipped && batch.reason) {
                    emit({ type: "error", message: batch.reason, fatal: false });
                  }
                } catch (error) {
                  const message =
                    error instanceof Error ? error.message : "Unknown scraper failure.";
                  emit({ type: "error", message, fatal: false });
                }
              }),
            ),
          ),
        );

        await Promise.all(scrapeTasks);
        ensureActive(request.signal);

        emit(
          createStatusEvent({
            phase: "cheap-scoring",
            startedAt,
            budget,
            pagesFetched,
            uniqueResults: listings.size,
            shortlistedCount,
          }),
        );

        const ranked = Array.from(listings.values()).sort(
          (left, right) => (right.coarseScore ?? 0) - (left.coarseScore ?? 0),
        );
        shortlistedCount = Math.min(
          MAX_SHORTLIST,
          budget.snapshot().remaining,
          ranked.length,
        );

        const shortlist = new Set(
          ranked.slice(0, shortlistedCount).map((listing) => `${listing.marketplace}:${listing.id}`),
        );

        emit(
          createStatusEvent({
            phase: "image-scoring",
            startedAt,
            budget,
            pagesFetched,
            uniqueResults: listings.size,
            shortlistedCount,
          }),
        );

        const imageLimit = createLimiter(IMAGE_CONCURRENCY);
        const imageTasks: Promise<void>[] = [];
        let imageProcessed = 0;

        for (const listing of listings.values()) {
          ensureActive(request.signal);
          const key = `${listing.marketplace}:${listing.id}`;

          if (!shortlist.has(key)) {
            markWithoutImageScore(listing, "Below the shortlist cutoff for image scoring.");
            emit({ type: "result", data: listing });
            continue;
          }

          listing.shortlisted = true;

          if (!listing.imageUrl) {
            listing.signals = [
              ...listing.signals.filter((signal) => signal.name !== "phash"),
              unavailablePhashSignal("Listing image is missing."),
            ];
            listing.score = computeFinalScore(listing.signals);
            listing.topReasons = topReasons(listing.signals);
            listing.scoredAt = Date.now();
            emit({ type: "result", data: listing });
            continue;
          }

          imageTasks.push(
            imageLimit(async () => {
              try {
                const imageBuffer = await fetchImageBuffer(
                  listing.imageUrl!,
                  budget,
                  request.signal,
                );
                const hashes = await computeImageHashes(imageBuffer);
                const phashSignal = scorePhashSimilarity(hashes, references);
                listing.signals = [
                  ...listing.signals.filter((signal) => signal.name !== "phash"),
                  phashSignal,
                ];
              } catch (error) {
                const message =
                  error instanceof Error ? error.message : "Image similarity failed.";
                listing.signals = [
                  ...listing.signals.filter((signal) => signal.name !== "phash"),
                  unavailablePhashSignal(message),
                ];
              }

              listing.score = computeFinalScore(listing.signals);
              listing.topReasons = topReasons(listing.signals);
              listing.scoredAt = Date.now();
              emit({ type: "result", data: listing });

              imageProcessed += 1;
              if (imageProcessed % 5 === 0 || imageProcessed === shortlistedCount) {
                emit(
                  createStatusEvent({
                    phase: "image-scoring",
                    startedAt,
                    budget,
                    pagesFetched,
                    uniqueResults: listings.size,
                    shortlistedCount,
                  }),
                );
              }
            }),
          );
        }

        await Promise.all(imageTasks);

        emit(
          createStatusEvent({
            phase: "done",
            startedAt,
            budget,
            pagesFetched,
            uniqueResults: listings.size,
            shortlistedCount,
          }),
        );
        emit({ type: "done" });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Search job failed unexpectedly.";
        emit({ type: "error", message, fatal: true });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "application/x-ndjson; charset=utf-8",
    },
  });
}
