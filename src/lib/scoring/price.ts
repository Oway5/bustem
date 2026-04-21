import type { NormalizedListing, ReferenceItem, Signal } from "@/lib/types";
import { clamp, median } from "@/lib/scoring/shared";

const WEIGHT = 0.2;

function isComparableCondition(condition: string | null) {
  if (!condition) {
    return true;
  }

  const normalized = condition.toLowerCase();
  return !normalized.includes("pre-owned") && !normalized.includes("used");
}

export function scorePriceAnomaly(
  listing: NormalizedListing,
  references: ReferenceItem[],
) {
  const rawTotal = listing.totalPrice ?? listing.price;
  const matchedReference = references.find(
    (reference) => reference.id === listing.matchReferenceId,
  );

  const comparablePrices = references
    .map((reference) => reference.medianPrice)
    .filter((price): price is number => price !== null);

  const referenceMedian =
    matchedReference?.medianPrice ?? median(comparablePrices) ?? null;

  if (!listing.fixedPrice || !isComparableCondition(listing.condition) || rawTotal === null) {
    return {
      name: "price",
      score: 0,
      weight: WEIGHT,
      contribution: 0,
      available: false,
      reason: "Price is not comparable for this listing condition or sale format.",
      raw: {
        listingPrice: listing.price,
        shippingPrice: listing.shippingPrice,
        totalPrice: listing.totalPrice,
        referenceMedian,
        deviationPct: null,
        condition: listing.condition,
      },
    } satisfies Signal;
  }

  if (referenceMedian === null || referenceMedian <= 0) {
    return {
      name: "price",
      score: 0,
      weight: WEIGHT,
      contribution: 0,
      available: false,
      reason: "Reference price data is unavailable.",
      raw: {
        listingPrice: listing.price,
        shippingPrice: listing.shippingPrice,
        totalPrice: listing.totalPrice,
        referenceMedian,
        deviationPct: null,
        condition: listing.condition,
      },
    } satisfies Signal;
  }

  const deviationPct = (referenceMedian - rawTotal) / referenceMedian;
  const score = clamp((deviationPct + 0.05) / 0.55);

  return {
    name: "price",
    score,
    weight: WEIGHT,
    contribution: score * WEIGHT,
    available: true,
    reason:
      deviationPct > 0.25
        ? "Listing is materially cheaper than authentic reference pricing."
        : deviationPct > 0.1
          ? "Listing is somewhat cheaper than authentic reference pricing."
          : "Listing price is close to authentic reference pricing.",
    raw: {
      listingPrice: listing.price,
      shippingPrice: listing.shippingPrice,
      totalPrice: listing.totalPrice,
      referenceMedian,
      deviationPct,
      condition: listing.condition,
    },
  } satisfies Signal;
}
