"use client";

import { startTransition, useEffect, useRef, useState } from "react";

import type { ErrorEvent, Result, StatusEvent, StreamEvent } from "@/lib/types";

function upsertResult(items: Result[], incoming: Result) {
  const index = items.findIndex(
    (item) =>
      item.marketplace === incoming.marketplace && item.id === incoming.id,
  );

  if (index === -1) {
    return [...items, incoming];
  }

  const next = [...items];
  next[index] = incoming;
  return next;
}

function formatCurrency(value: number | null) {
  if (value === null) {
    return "Unknown";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export default function Home() {
  const [results, setResults] = useState<Result[]>([]);
  const [status, setStatus] = useState<StatusEvent | null>(null);
  const [errors, setErrors] = useState<ErrorEvent[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [marketplaceFilter, setMarketplaceFilter] = useState<
    "all" | "amazon" | "ebay"
  >("all");
  const [scoreThreshold, setScoreThreshold] = useState(0.35);
  const [showNonShortlisted, setShowNonShortlisted] = useState(true);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    const startedAt = Date.now();
    setElapsedMs(0);
    const intervalId = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 100);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isRunning]);

  const filteredResults = results
    .filter((result) =>
      marketplaceFilter === "all" ? true : result.marketplace === marketplaceFilter,
    )
    .filter((result) => result.score >= scoreThreshold)
    .filter((result) => (showNonShortlisted ? true : result.shortlisted))
    .sort((left, right) => right.score - left.score);

  async function startSearch() {
    abortRef.current?.abort();

    const abortController = new AbortController();
    abortRef.current = abortController;

    setResults([]);
    setStatus(null);
    setErrors([]);
    setIsRunning(true);
    setIsFinished(false);

    try {
      const response = await fetch("/api/search", {
        method: "GET",
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Search request failed with ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }

          const event = JSON.parse(line) as StreamEvent;
          startTransition(() => {
            if (event.type === "status") {
              setStatus(event);
            } else if (event.type === "result") {
              setResults((current) => upsertResult(current, event.data));
            } else if (event.type === "error") {
              setErrors((current) => [...current, event]);
            } else if (event.type === "done") {
              setIsFinished(true);
            }
          });
        }
      }

      setIsFinished(true);
    } catch (error) {
      if (abortController.signal.aborted) {
        setErrors((current) => [
          ...current,
          { type: "error", message: "Search cancelled by user.", fatal: false },
        ]);
      } else {
        setErrors((current) => [
          ...current,
          {
            type: "error",
            message:
              error instanceof Error ? error.message : "Search failed unexpectedly.",
            fatal: true,
          },
        ]);
      }
    } finally {
      setIsRunning(false);
    }
  }

  function cancelSearch() {
    abortRef.current?.abort();
    setIsRunning(false);
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(210,111,73,0.2),_transparent_35%),radial-gradient(circle_at_top_right,_rgba(11,95,83,0.16),_transparent_28%),linear-gradient(180deg,_#f7f3ea_0%,_#f5efe5_100%)] px-5 py-8 text-stone-900 sm:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="overflow-hidden rounded-[2rem] border border-stone-900/10 bg-[rgba(255,250,242,0.92)] p-6 shadow-[0_24px_80px_rgba(71,51,33,0.10)] backdrop-blur sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-4">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#8b5e34]">
                Bustem Infringement Search
              </p>
              <h1 className="max-w-2xl font-serif text-4xl leading-tight tracking-tight text-stone-950 sm:text-5xl">
                Progressive Amazon and eBay triage for suspicious Comfrt hoodie listings.
              </h1>
              <p className="max-w-2xl text-sm leading-7 text-stone-700 sm:text-base">
                The pipeline fans out across five query variants, deduplicates by
                ASIN or item id, emits coarse-scored matches as scrape pages land,
                then upgrades a shortlist with image similarity.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={startSearch}
                disabled={isRunning}
                className="rounded-full bg-[#123c36] px-5 py-3 text-sm font-semibold text-stone-50 transition hover:bg-[#0e2f2a] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isRunning ? "Search Running" : "Start Search Job"}
              </button>
              <button
                type="button"
                onClick={cancelSearch}
                disabled={!isRunning}
                className="rounded-full border border-stone-900/15 bg-white/80 px-5 py-3 text-sm font-semibold text-stone-800 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatusCard
            label="Phase"
            value={status?.phase ?? "idle"}
            detail={isFinished ? "job complete" : isRunning ? "streaming live" : "waiting"}
          />
          <StatusCard
            label="Elapsed"
            value={formatDuration(elapsedMs)}
            detail={`${status?.uniqueResults ?? 0} unique results`}
          />
          <StatusCard
            label="Requests"
            value={String(status?.requests.total ?? 0)}
            detail={`A ${status?.requests.amazon ?? 0} / E ${status?.requests.ebay ?? 0} / I ${status?.requests.images ?? 0}`}
          />
          <StatusCard
            label="Budget"
            value={`${status?.budget.used ?? 0}/${status?.budget.cap ?? 120}`}
            detail={`${status?.budget.remaining ?? 120} remaining`}
          />
          <StatusCard
            label="Pages"
            value={String(status?.pagesFetched ?? 0)}
            detail={`${status?.shortlistedCount ?? 0} shortlisted`}
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-4 rounded-[1.75rem] border border-stone-900/10 bg-white/80 p-5 shadow-[0_12px_32px_rgba(71,51,33,0.08)] backdrop-blur">
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-stone-950">Filters</h2>
              <p className="text-sm leading-6 text-stone-600">
                Results upsert in place as stronger signals arrive.
              </p>
            </div>

            <label className="space-y-2 text-sm font-medium text-stone-700">
              <span>Marketplace</span>
              <select
                value={marketplaceFilter}
                onChange={(event) =>
                  setMarketplaceFilter(
                    event.target.value as "all" | "amazon" | "ebay",
                  )
                }
                className="w-full rounded-2xl border border-stone-900/10 bg-stone-50 px-4 py-3 text-sm outline-none transition focus:border-[#123c36]"
              >
                <option value="all">All marketplaces</option>
                <option value="amazon">Amazon only</option>
                <option value="ebay">eBay only</option>
              </select>
            </label>

            <label className="space-y-3 text-sm font-medium text-stone-700">
              <span>Minimum score: {formatPercent(scoreThreshold)}</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={scoreThreshold}
                onChange={(event) =>
                  setScoreThreshold(Number.parseFloat(event.target.value))
                }
                className="w-full accent-[#8b5e34]"
              />
            </label>

            <label className="flex items-center gap-3 rounded-2xl border border-stone-900/10 bg-stone-50 px-4 py-3 text-sm text-stone-700">
              <input
                type="checkbox"
                checked={showNonShortlisted}
                onChange={(event) => setShowNonShortlisted(event.target.checked)}
                className="size-4 rounded accent-[#123c36]"
              />
              Show results that never reached image scoring
            </label>

            <div className="rounded-2xl bg-[#123c36] px-4 py-4 text-sm text-stone-100">
              <p className="font-semibold">Scoring model</p>
              <p className="mt-2 leading-6 text-stone-200/90">
                Brand cue, title similarity, and price anomaly run on every
                listing. pHash similarity only runs on the current shortlist.
              </p>
            </div>

            {errors.length > 0 ? (
              <div className="space-y-2 rounded-2xl border border-[#b6422f]/20 bg-[#fff0ec] p-4 text-sm text-[#7f2d1e]">
                <p className="font-semibold">Pipeline notices</p>
                {errors.map((error, index) => (
                  <p key={`${error.message}-${index}`}>{error.message}</p>
                ))}
              </div>
            ) : null}
          </aside>

          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-stone-950">
                  Ranked Results
                </h2>
                <p className="text-sm text-stone-600">
                  Showing {filteredResults.length} of {results.length} deduplicated
                  listings.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {filteredResults.length === 0 ? (
                <div className="rounded-[1.75rem] border border-dashed border-stone-900/15 bg-white/70 p-10 text-center text-sm text-stone-600">
                  Start a job to stream results, or lower the score threshold if
                  the current filter is too strict.
                </div>
              ) : null}

              {filteredResults.map((result) => {
                const phashSignal = result.signals.find(
                  (signal) => signal.name === "phash",
                );

                return (
                  <article
                    key={`${result.marketplace}:${result.id}`}
                    className="overflow-hidden rounded-[1.75rem] border border-stone-900/10 bg-white/90 shadow-[0_16px_40px_rgba(71,51,33,0.08)]"
                  >
                    <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row">
                      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[1.5rem] bg-stone-100 lg:w-72">
                        {result.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={result.imageUrl}
                            alt={result.title}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-sm text-stone-500">
                            No image available
                          </div>
                        )}
                      </div>

                      <div className="flex min-w-0 flex-1 flex-col gap-4">
                        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                          <div className="space-y-3">
                            <div className="flex flex-wrap gap-2">
                              <span className="rounded-full bg-stone-900 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-stone-50">
                                {result.marketplace}
                              </span>
                              <span className="rounded-full bg-[#efe3d2] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#8b5e34]">
                                {result.shortlisted ? "image-scored" : "cheap-only"}
                              </span>
                              <span className="rounded-full bg-[#e1efe9] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#123c36]">
                                {result.id}
                              </span>
                            </div>

                            <div className="space-y-2">
                              <h3 className="text-xl font-semibold leading-8 text-stone-950">
                                {result.title}
                              </h3>
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-stone-600">
                                <span>Price {formatCurrency(result.totalPrice ?? result.price)}</span>
                                <span>Condition {result.condition ?? "Unknown"}</span>
                                <span>{result.queries.length} query hits</span>
                              </div>
                            </div>
                          </div>

                          <div className="rounded-[1.5rem] bg-stone-950 px-5 py-4 text-right text-stone-50">
                            <p className="text-xs uppercase tracking-[0.18em] text-stone-300">
                              Infringement score
                            </p>
                            <p className="mt-2 text-4xl font-semibold">
                              {formatPercent(result.score)}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2 text-sm text-stone-700">
                          {result.topReasons.map((reason) => (
                            <span
                              key={reason}
                              className="rounded-full border border-stone-900/10 bg-stone-50 px-3 py-2"
                            >
                              {reason}
                            </span>
                          ))}
                        </div>

                        <div className="flex flex-wrap gap-2 text-sm text-stone-600">
                          {result.seenIn.map((seen) => (
                            <span
                              key={`${seen.query}-${seen.page}`}
                              className="rounded-full bg-[#f4eee6] px-3 py-1.5"
                            >
                              {seen.query} | page {seen.page}
                            </span>
                          ))}
                        </div>

                        <div className="flex flex-wrap items-center gap-4 text-sm text-stone-600">
                          <a
                            href={result.url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-semibold text-[#123c36] underline decoration-[#123c36]/30 underline-offset-4"
                          >
                            Open listing
                          </a>
                          <span>
                            Image signal{" "}
                            {phashSignal?.available
                              ? "available"
                              : phashSignal
                                ? "unavailable"
                                : "pending"}
                          </span>
                        </div>

                        <details className="group rounded-[1.5rem] border border-stone-900/10 bg-[#faf7f2] transition hover:border-[#123c36]/30 hover:shadow-[0_0_0_3px_rgba(18,60,54,0.12),0_12px_28px_rgba(18,60,54,0.12)]">
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-semibold text-stone-800 transition group-hover:text-[#123c36]">
                            <span>Signal breakdown and raw values</span>
                            <svg
                              aria-hidden="true"
                              viewBox="0 0 20 20"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="size-4 shrink-0 text-stone-500 transition-transform duration-200 group-hover:text-[#123c36] group-open:rotate-180"
                            >
                              <path d="M5 8l5 5 5-5" />
                            </svg>
                          </summary>
                          <div className="border-t border-stone-900/10 px-5 py-5">
                            <div className="grid gap-4 xl:grid-cols-2">
                              {result.signals.map((signal) => (
                                <div
                                  key={signal.name}
                                  className="rounded-[1.25rem] border border-stone-900/10 bg-white p-4"
                                >
                                  <div className="flex items-start justify-between gap-4">
                                    <div>
                                      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-stone-500">
                                        {signal.name}
                                      </p>
                                      <p className="mt-2 text-sm leading-6 text-stone-700">
                                        {signal.reason}
                                      </p>
                                    </div>
                                    <div className="text-right text-sm text-stone-600">
                                      <p>score {formatPercent(signal.score)}</p>
                                      <p>weight {signal.weight.toFixed(2)}</p>
                                      <p>contrib {signal.contribution.toFixed(2)}</p>
                                      <p>{signal.available ? "available" : "missing"}</p>
                                    </div>
                                  </div>
                                  <pre className="mt-4 overflow-x-auto rounded-2xl bg-stone-950/95 p-4 text-xs leading-6 text-stone-100">
                                    {JSON.stringify(signal.raw, null, 2)}
                                  </pre>
                                </div>
                              ))}
                            </div>
                          </div>
                        </details>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}

function StatusCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-[1.5rem] border border-stone-900/10 bg-white/80 p-5 shadow-[0_12px_32px_rgba(71,51,33,0.08)] backdrop-blur">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
        {label}
      </p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-stone-950">
        {value}
      </p>
      <p className="mt-2 text-sm text-stone-600">{detail}</p>
    </div>
  );
}
