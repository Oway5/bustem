import type { NormalizedListing, ReferenceItem, Signal } from "@/lib/types";
import { clamp } from "@/lib/scoring/shared";

const WEIGHT = 0.2;

function isComparableCondition(condition: string | null) {
  if (!condition) {
    return false;
  }

  const normalized = condition.toLowerCase();
  // Only truly new, tagged stock is comparable to reference retail pricing.
  // "new (other)", "new without tags", "open box", "refurbished", and "used" are
  // all deliberately excluded — their prices are not apples-to-apples and the
  // `available: false` branch below produces a clear reason for those.
  return (
    normalized === "new" ||
    normalized.includes("brand new") ||
    normalized.includes("new with tags")
  );
}

export function scorePriceAnomaly(
  listing: NormalizedListing,
  references: ReferenceItem[],
) {
  const rawTotal = listing.totalPrice ?? listing.price;
  const matchedReference = listing.matchReferenceId
    ? references.find((reference) => reference.id === listing.matchReferenceId) ?? null
    : null;
  const referenceMedian = matchedReference?.medianPrice ?? null;

  if (listing.saleFormat !== "fixed") {
    return {
      name: "price",
      score: 0,
      weight: WEIGHT,
      contribution: 0,
      available: false,
      reason:
        listing.saleFormat === "auction"
          ? "Price is not comparable for auction listings."
          : "Price is not comparable because the sale format is unknown.",
      raw: {
        listingPrice: listing.price,
        shippingPrice: listing.shippingPrice,
        totalPrice: listing.totalPrice,
        referenceMedian,
        deviationPct: null,
        condition: listing.condition,
        saleFormat: listing.saleFormat,
        matchedReferenceId: listing.matchReferenceId ?? null,
      },
    } satisfies Signal;
  }

  if (!isComparableCondition(listing.condition)) {
    return {
      name: "price",
      score: 0,
      weight: WEIGHT,
      contribution: 0,
      available: false,
      reason: listing.condition
        ? "Price is not comparable for this listing condition."
        : "Price is not comparable because the listing condition is missing.",
      raw: {
        listingPrice: listing.price,
        shippingPrice: listing.shippingPrice,
        totalPrice: listing.totalPrice,
        referenceMedian,
        deviationPct: null,
        condition: listing.condition,
        saleFormat: listing.saleFormat,
        matchedReferenceId: listing.matchReferenceId ?? null,
      },
    } satisfies Signal;
  }

  if (rawTotal === null) {
    return {
      name: "price",
      score: 0,
      weight: WEIGHT,
      contribution: 0,
      available: false,
      reason: "Price is not comparable because the listing price is missing.",
      raw: {
        listingPrice: listing.price,
        shippingPrice: listing.shippingPrice,
        totalPrice: listing.totalPrice,
        referenceMedian,
        deviationPct: null,
        condition: listing.condition,
        saleFormat: listing.saleFormat,
        matchedReferenceId: listing.matchReferenceId ?? null,
      },
    } satisfies Signal;
  }

  if (!matchedReference) {
    return {
      name: "price",
      score: 0,
      weight: WEIGHT,
      contribution: 0,
      available: false,
      reason:
        "Price is not comparable without a credible reference title match.",
      raw: {
        listingPrice: listing.price,
        shippingPrice: listing.shippingPrice,
        totalPrice: listing.totalPrice,
        referenceMedian,
        deviationPct: null,
        condition: listing.condition,
        saleFormat: listing.saleFormat,
        matchedReferenceId: listing.matchReferenceId ?? null,
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
      reason: "Reference price data is unavailable for the matched item.",
      raw: {
        listingPrice: listing.price,
        shippingPrice: listing.shippingPrice,
        totalPrice: listing.totalPrice,
        referenceMedian,
        deviationPct: null,
        condition: listing.condition,
        saleFormat: listing.saleFormat,
        matchedReferenceId: listing.matchReferenceId ?? null,
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
      saleFormat: listing.saleFormat,
      matchedReferenceId: listing.matchReferenceId ?? null,
    },
  } satisfies Signal;
}
