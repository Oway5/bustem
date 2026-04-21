import type { ReferenceItem, Signal } from "@/lib/types";
import { clamp, tokenize, unique } from "@/lib/scoring/shared";

const WEIGHT = 0.3;

export function scoreTitleSimilarity(
  title: string,
  references: ReferenceItem[],
): Signal {
  const listingTokens = unique(tokenize(title));
  const listingSet = new Set(listingTokens);

  let bestReference: ReferenceItem | null = null;
  let bestShared: string[] = [];
  let bestScore = 0;

  for (const reference of references) {
    const referenceTokens = unique(tokenize(reference.title));
    const sharedTokens = referenceTokens.filter((token) => listingSet.has(token));
    const score =
      referenceTokens.length === 0
        ? 0
        : sharedTokens.length / referenceTokens.length;

    if (score > bestScore) {
      bestScore = score;
      bestReference = reference;
      bestShared = sharedTokens;
    }
  }

  const normalizedScore =
    bestShared.includes("hoodie") || bestShared.includes("zip")
      ? clamp(bestScore)
      : clamp(bestScore * 0.9);

  return {
    name: "title",
    score: normalizedScore,
    weight: WEIGHT,
    contribution: normalizedScore * WEIGHT,
    available: true,
    reason: bestReference
      ? `Title overlaps with reference "${bestReference.title}".`
      : "No meaningful title overlap with the reference set.",
    raw: {
      overlap: normalizedScore,
      matchedReferenceId: bestReference?.id ?? null,
      matchedReferenceTitle: bestReference?.title ?? null,
      sharedTokens: bestShared,
    },
  };
}
