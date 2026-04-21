import type { Signal } from "@/lib/types";
import { levenshtein, tokenize } from "@/lib/scoring/shared";

const WEIGHT = 0.15;

export function scoreBrandCue(title: string): Signal {
  const tokens = tokenize(title);
  const exactMatch = tokens.find((token) => token === "comfrt");

  if (exactMatch) {
    return {
      name: "brandCue",
      score: 1,
      weight: WEIGHT,
      contribution: WEIGHT,
      available: true,
      reason: 'Title contains an exact "comfrt" brand token.',
      raw: {
        matchedToken: exactMatch,
        matchType: "exact",
        editDistance: 0,
      },
    };
  }

  let closestToken: string | null = null;
  let closestDistance: number | null = null;

  for (const token of tokens) {
    const distance = levenshtein(token, "comfrt");
    if (closestDistance === null || distance < closestDistance) {
      closestDistance = distance;
      closestToken = token;
    }
  }

  const fuzzyEligible =
    closestToken !== null &&
    closestDistance !== null &&
    closestToken.length >= 5 &&
    closestDistance <= 2;

  if (fuzzyEligible && closestDistance !== null) {
    const score = closestDistance === 1 ? 0.72 : 0.46;
    return {
      name: "brandCue",
      score,
      weight: WEIGHT,
      contribution: score * WEIGHT,
      available: true,
      reason: `Title includes a near-match brand token (${closestToken}).`,
      raw: {
        matchedToken: closestToken,
        matchType: "fuzzy",
        editDistance: closestDistance,
      },
    };
  }

  return {
    name: "brandCue",
    score: 0,
    weight: WEIGHT,
    contribution: 0,
    available: true,
    reason: 'Title has no "comfrt" brand cue.',
    raw: {
      matchedToken: closestToken,
      matchType: "none",
      editDistance: closestDistance,
    },
  };
}
