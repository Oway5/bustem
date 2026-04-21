import type { ReferenceItem, Signal } from "@/lib/types";
import { clamp, tokenize, unique } from "@/lib/scoring/shared";

const WEIGHT = 0.3;
const GENERIC_TITLE_TOKENS = new Set([
  "hoodie",
  "zip",
  "pullover",
  "sweatshirt",
  "oversized",
  "casual",
  "jacket",
  "drawstring",
  "fleece",
  "lightweight",
  "comfortable",
  "heavyweight",
  "full",
  "half",
  "quarter",
  "mock",
  "neck",
]);
const AMBIGUOUS_REFERENCE_TOKENS = new Set([
  "basic",
  "camo",
  "cloud",
  "love",
  "pastel",
  "travel",
]);

export function scoreTitleSimilarity(
  title: string,
  references: ReferenceItem[],
): Signal {
  const listingTokens = unique(tokenize(title));
  const listingSet = new Set(listingTokens);

  let bestReference: ReferenceItem | null = null;
  let bestSharedStrong: string[] = [];
  let bestSharedAmbiguous: string[] = [];
  let bestSharedGeneric: string[] = [];
  let bestStrongReferenceTokens: string[] = [];
  let bestAmbiguousReferenceTokens: string[] = [];
  let bestScore = 0;

  for (const reference of references) {
    const referenceTokens = unique(tokenize(reference.title));
    const ambiguousReferenceTokens = referenceTokens.filter((token) =>
      AMBIGUOUS_REFERENCE_TOKENS.has(token),
    );
    const strongReferenceTokens = referenceTokens.filter(
      (token) =>
        !GENERIC_TITLE_TOKENS.has(token) && !AMBIGUOUS_REFERENCE_TOKENS.has(token),
    );
    const sharedStrongTokens = strongReferenceTokens.filter((token) =>
      listingSet.has(token),
    );
    const sharedAmbiguousTokens = ambiguousReferenceTokens.filter((token) =>
      listingSet.has(token),
    );
    const sharedGenericTokens = referenceTokens.filter(
      (token) => GENERIC_TITLE_TOKENS.has(token) && listingSet.has(token),
    );

    let score = 0;
    if (sharedStrongTokens.length > 0) {
      const strongCoverage =
        sharedStrongTokens.length / Math.max(strongReferenceTokens.length, 1);
      const ambiguousBonus = Math.min(sharedAmbiguousTokens.length, 1) * 0.1;
      const genericBonus = Math.min(sharedGenericTokens.length, 2) * 0.05;
      score = clamp(strongCoverage + ambiguousBonus + genericBonus);
    } else if (sharedAmbiguousTokens.length > 0) {
      const ambiguousCoverage =
        sharedAmbiguousTokens.length /
        Math.max(ambiguousReferenceTokens.length, 1);
      const genericBonus = Math.min(sharedGenericTokens.length, 2) * 0.03;
      score = clamp(ambiguousCoverage * 0.2 + genericBonus, 0, 0.25);
    } else if (sharedGenericTokens.length >= 2) {
      // Generic garment words alone should not create a strong match.
      score = 0.05;
    } else if (sharedGenericTokens.length === 1) {
      score = 0.02;
    }

    if (
      score > bestScore ||
      (score === bestScore &&
        sharedStrongTokens.length > bestSharedStrong.length)
    ) {
      bestScore = score;
      bestReference = reference;
      bestSharedStrong = sharedStrongTokens;
      bestSharedAmbiguous = sharedAmbiguousTokens;
      bestSharedGeneric = sharedGenericTokens;
      bestStrongReferenceTokens = strongReferenceTokens;
      bestAmbiguousReferenceTokens = ambiguousReferenceTokens;
    }
  }

  const hasStrongMatch = bestSharedStrong.length > 0;
  const matchedReferenceId = hasStrongMatch ? bestReference?.id ?? null : null;
  const matchedReferenceTitle = hasStrongMatch
    ? bestReference?.title ?? null
    : null;

  return {
    name: "title",
    score: bestScore,
    weight: WEIGHT,
    contribution: bestScore * WEIGHT,
    available: true,
    reason: hasStrongMatch && bestReference
      ? `Title matches distinctive terms from reference "${bestReference.title}".`
      : bestSharedAmbiguous.length > 0
        ? "Title only matches broad collection words, so title confidence stays capped."
      : bestSharedGeneric.length > 0
        ? "Title only overlaps on generic garment terms, so title confidence stays low."
      : "No meaningful title overlap with the reference set.",
    raw: {
      overlap: bestScore,
      matchedReferenceId,
      matchedReferenceTitle,
      hasStrongMatch,
      sharedTokens: [...bestSharedStrong, ...bestSharedAmbiguous, ...bestSharedGeneric],
      sharedStrongTokens: bestSharedStrong,
      sharedAmbiguousTokens: bestSharedAmbiguous,
      sharedGenericTokens: bestSharedGeneric,
      referenceStrongTokens: bestStrongReferenceTokens,
      referenceAmbiguousTokens: bestAmbiguousReferenceTokens,
    },
  };
}
