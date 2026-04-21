import sharp from "sharp";

import type { ReferenceItem, Signal } from "@/lib/types";
import { clamp } from "@/lib/scoring/shared";

const WEIGHT = 0.35;
const HASH_SIZE = 8;
const SAMPLE_SIZE = 32;

export async function computePhash(buffer: Buffer) {
  const pixels = await sharp(buffer)
    .grayscale()
    .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: "fill" })
    .raw()
    .toBuffer();

  const values = Array.from({ length: SAMPLE_SIZE }, (_, y) =>
    Array.from({ length: SAMPLE_SIZE }, (_, x) => pixels[y * SAMPLE_SIZE + x]),
  );

  const coefficients: number[] = [];

  for (let u = 0; u < HASH_SIZE; u += 1) {
    for (let v = 0; v < HASH_SIZE; v += 1) {
      let sum = 0;
      for (let x = 0; x < SAMPLE_SIZE; x += 1) {
        for (let y = 0; y < SAMPLE_SIZE; y += 1) {
          sum +=
            values[y][x] *
            Math.cos(((2 * x + 1) * u * Math.PI) / (2 * SAMPLE_SIZE)) *
            Math.cos(((2 * y + 1) * v * Math.PI) / (2 * SAMPLE_SIZE));
        }
      }

      const alphaU = u === 0 ? 1 / Math.sqrt(2) : 1;
      const alphaV = v === 0 ? 1 / Math.sqrt(2) : 1;
      coefficients.push((alphaU * alphaV * sum) / 4);
    }
  }

  const lowFrequency = coefficients.slice(1);
  const threshold =
    [...lowFrequency].sort((a, b) => a - b)[
      Math.floor(lowFrequency.length / 2)
    ];

  let hash = BigInt(0);
  for (const coefficient of coefficients) {
    hash <<= BigInt(1);
    if (coefficient > threshold) {
      hash |= BigInt(1);
    }
  }

  return hash.toString(16).padStart(16, "0");
}

export function hammingDistance(left: string, right: string) {
  let xor = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let count = 0;
  const zero = BigInt(0);
  const one = BigInt(1);

  while (xor > zero) {
    count += Number(xor & one);
    xor >>= one;
  }

  return count;
}

export function scorePhashSimilarity(
  listingHash: string,
  references: ReferenceItem[],
): Signal {
  const candidates = references
    .filter((reference) => reference.phash)
    .map((reference) => ({
      referenceId: reference.id,
      referenceTitle: reference.title,
      distance: hammingDistance(listingHash, reference.phash!),
    }))
    .sort((a, b) => a.distance - b.distance);

  const best = candidates[0];

  if (!best) {
    return {
      name: "phash",
      score: 0,
      weight: WEIGHT,
      contribution: 0,
      available: false,
      reason: "Reference image hashes are unavailable.",
      raw: {
        minHammingDistance: null,
        matchedReferenceId: null,
        matchedReferenceTitle: null,
        allDistances: [],
      },
    };
  }

  const score = clamp((20 - best.distance) / 20);

  return {
    name: "phash",
    score,
    weight: WEIGHT,
    contribution: score * WEIGHT,
    available: true,
    reason:
      best.distance <= 8
        ? `Listing image is very close to reference "${best.referenceTitle}".`
        : best.distance <= 14
          ? `Listing image has moderate similarity to reference "${best.referenceTitle}".`
          : "Listing image is not especially close to the reference set.",
    raw: {
      minHammingDistance: best.distance,
      matchedReferenceId: best.referenceId,
      matchedReferenceTitle: best.referenceTitle,
      allDistances: candidates,
    },
  };
}

export function unavailablePhashSignal(reason: string): Signal {
  return {
    name: "phash",
    score: 0,
    weight: WEIGHT,
    contribution: 0,
    available: false,
    reason,
    raw: {
      minHammingDistance: null,
      matchedReferenceId: null,
      matchedReferenceTitle: null,
      allDistances: [],
    },
  };
}
