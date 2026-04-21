import type { NormalizedListing, ReferenceItem, Signal } from "@/lib/types";
import { scoreBrandCue } from "@/lib/scoring/brandCue";
import { unavailablePhashSignal } from "@/lib/scoring/phash";
import { scorePriceAnomaly } from "@/lib/scoring/price";
import { scoreTitleSimilarity } from "@/lib/scoring/title";

export function computeFinalScore(signals: Signal[]) {
  const availableSignals = signals.filter((signal) => signal.available);
  const weightTotal = availableSignals.reduce(
    (sum, signal) => sum + signal.weight,
    0,
  );

  if (weightTotal === 0) {
    return 0;
  }

  return (
    availableSignals.reduce((sum, signal) => sum + signal.contribution, 0) /
    weightTotal
  );
}

export function topReasons(signals: Signal[]) {
  const positive = signals
    .filter((signal) => signal.available && signal.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution);

  if (positive.length === 0) {
    const fallback = signals
      .filter((signal) => signal.reason)
      .sort((a, b) => b.score - a.score);
    return fallback.slice(0, 2).map((signal) => signal.reason);
  }

  return positive.slice(0, 3).map((signal) => signal.reason);
}

export function applyCheapSignals(
  listing: NormalizedListing,
  references: ReferenceItem[],
) {
  const titleSignal = scoreTitleSimilarity(listing.title, references);
  const signals = [
    scoreBrandCue(listing.title),
    titleSignal,
    scorePriceAnomaly(
      {
        ...listing,
        matchReferenceId:
          typeof titleSignal.raw.matchedReferenceId === "string"
            ? titleSignal.raw.matchedReferenceId
            : null,
      },
      references,
    ),
  ];

  listing.matchReferenceId =
    typeof titleSignal.raw.matchedReferenceId === "string"
      ? titleSignal.raw.matchedReferenceId
      : null;
  listing.matchReferenceTitle =
    typeof titleSignal.raw.matchedReferenceTitle === "string"
      ? titleSignal.raw.matchedReferenceTitle
      : null;

  const score = computeFinalScore(signals);

  listing.signals = signals;
  listing.coarseScore = score;
  listing.score = score;
  listing.topReasons = topReasons(signals);
  listing.scoredAt = Date.now();

  return listing;
}

export function markWithoutImageScore(listing: NormalizedListing, reason: string) {
  listing.shortlisted = false;
  listing.signals = [...listing.signals.filter((signal) => signal.name !== "phash"), unavailablePhashSignal(reason)];
  listing.score = computeFinalScore(listing.signals);
  listing.topReasons = topReasons(listing.signals);
  listing.scoredAt = Date.now();
  return listing;
}
