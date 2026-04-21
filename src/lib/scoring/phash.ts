import sharp from "sharp";

import type { ReferenceItem, Signal } from "@/lib/types";
import { clamp } from "@/lib/scoring/shared";

const WEIGHT = 0.35;
const HASH_SIZE = 8;
const SAMPLE_SIZE = 32;

// Precomputed DCT cosine table: COS_TABLE[u][x] = cos(((2x + 1) * u * PI) / (2 * SAMPLE_SIZE)).
// Building this once at module load removes ~32*32*8*8 = 65536 Math.cos calls per image.
const COS_TABLE: number[][] = Array.from({ length: HASH_SIZE }, (_unused, u) =>
  Array.from({ length: SAMPLE_SIZE }, (_inner, x) =>
    Math.cos(((2 * x + 1) * u * Math.PI) / (2 * SAMPLE_SIZE)),
  ),
);

export type ImageHashes = {
  phash: string;
  ahash: string;
  dhash: string;
};

function bitsToHex(bits: number[]) {
  let hash = BigInt(0);
  for (const bit of bits) {
    hash <<= BigInt(1);
    if (bit) {
      hash |= BigInt(1);
    }
  }
  return hash.toString(16).padStart(16, "0");
}

export async function computePhash(buffer: Buffer) {
  const pixels = await sharp(buffer)
    .grayscale()
    .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: "fill" })
    .raw()
    .toBuffer();

  const coefficients: number[] = [];

  for (let u = 0; u < HASH_SIZE; u += 1) {
    const cosU = COS_TABLE[u];
    for (let v = 0; v < HASH_SIZE; v += 1) {
      const cosV = COS_TABLE[v];
      let sum = 0;
      for (let y = 0; y < SAMPLE_SIZE; y += 1) {
        const rowOffset = y * SAMPLE_SIZE;
        const cosVy = cosV[y];
        for (let x = 0; x < SAMPLE_SIZE; x += 1) {
          sum += pixels[rowOffset + x] * cosU[x] * cosVy;
        }
      }

      const alphaU = u === 0 ? 1 / Math.sqrt(2) : 1;
      const alphaV = v === 0 ? 1 / Math.sqrt(2) : 1;
      coefficients.push((alphaU * alphaV * sum) / 4);
    }
  }

  // Drop the DC coefficient (index 0) so the hash reflects structure, not overall brightness.
  // Use the next 64 coefficients to build 64 bits. With HASH_SIZE=8 that's indices 1..64
  // (we have 64 coefficients total, so we need one more; pad with the last coefficient value
  // which is negligible if unavailable). In practice HASH_SIZE*HASH_SIZE=64, so slice(1,64)
  // gives 63 values. We also compare against the DC-less median but output exactly 64 bits
  // by comparing indices 1..64 where index 64 doesn't exist — so take slice(1) = 63 values
  // plus the median itself as a 64th bit position.
  const acCoefficients = coefficients.slice(1);
  const sorted = [...acCoefficients].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const bits = acCoefficients.map((coefficient) => (coefficient > median ? 1 : 0));
  // Pad to 64 bits by comparing the DC coefficient to the median of its AC neighbors.
  bits.push(coefficients[0] > median ? 1 : 0);

  return bitsToHex(bits);
}

export async function computeAhash(buffer: Buffer) {
  const size = 8;
  const pixels = await sharp(buffer)
    .grayscale()
    .resize(size, size, { fit: "fill" })
    .raw()
    .toBuffer();

  let total = 0;
  for (let i = 0; i < pixels.length; i += 1) {
    total += pixels[i];
  }
  const mean = total / pixels.length;

  const bits: number[] = [];
  for (let i = 0; i < pixels.length; i += 1) {
    bits.push(pixels[i] > mean ? 1 : 0);
  }
  return bitsToHex(bits);
}

export async function computeDhash(buffer: Buffer) {
  const width = 9;
  const height = 8;
  const pixels = await sharp(buffer)
    .grayscale()
    .resize(width, height, { fit: "fill" })
    .raw()
    .toBuffer();

  const bits: number[] = [];
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    for (let x = 0; x < width - 1; x += 1) {
      bits.push(pixels[rowOffset + x] > pixels[rowOffset + x + 1] ? 1 : 0);
    }
  }
  return bitsToHex(bits);
}

export async function computeImageHashes(buffer: Buffer): Promise<ImageHashes> {
  const [phash, ahash, dhash] = await Promise.all([
    computePhash(buffer),
    computeAhash(buffer),
    computeDhash(buffer),
  ]);
  return { phash, ahash, dhash };
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

type HashKind = "phash" | "ahash" | "dhash";

type CandidateDistance = {
  referenceId: string;
  referenceTitle: string;
  distance: number;
  bestHashKind: HashKind;
  phashDistance: number;
  ahashDistance: number;
  dhashDistance: number;
};

// Weighted ensemble: pHash captures structure best, aHash/dHash are cheap sanity checks.
// Combined score uses 0.5 * pHash + 0.25 * aHash + 0.25 * dHash; we also surface the raw
// minimum so operators can see which hash kind produced the best agreement per reference.
function combineDistances(phashD: number, ahashD: number, dhashD: number) {
  return phashD * 0.5 + ahashD * 0.25 + dhashD * 0.25;
}

function pickBestKind(phashD: number, ahashD: number, dhashD: number): HashKind {
  if (phashD <= ahashD && phashD <= dhashD) {
    return "phash";
  }
  if (dhashD <= ahashD) {
    return "dhash";
  }
  return "ahash";
}

export function scorePhashSimilarity(
  listingHashes: ImageHashes,
  references: ReferenceItem[],
): Signal {
  const candidates: CandidateDistance[] = references
    .filter((reference) => reference.hashes)
    .map((reference) => {
      const hashes = reference.hashes!;
      const phashDistance = hammingDistance(listingHashes.phash, hashes.phash);
      const ahashDistance = hammingDistance(listingHashes.ahash, hashes.ahash);
      const dhashDistance = hammingDistance(listingHashes.dhash, hashes.dhash);
      return {
        referenceId: reference.id,
        referenceTitle: reference.title,
        distance: combineDistances(phashDistance, ahashDistance, dhashDistance),
        bestHashKind: pickBestKind(phashDistance, ahashDistance, dhashDistance),
        phashDistance,
        ahashDistance,
        dhashDistance,
      };
    })
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
        phash: listingHashes.phash,
        ahash: listingHashes.ahash,
        dhash: listingHashes.dhash,
        minHammingDistance: null,
        matchedReferenceId: null,
        matchedReferenceTitle: null,
        bestHashKind: null,
        allDistances: [],
      },
    };
  }

  // Scoring uses the best single-hash Hamming distance so a strong dHash agreement still
  // rewards structural matches even when the pHash is noisy (e.g. cropped reference art).
  const minDistance = Math.min(
    best.phashDistance,
    best.ahashDistance,
    best.dhashDistance,
  );
  const score = clamp((20 - minDistance) / 20);

  return {
    name: "phash",
    score,
    weight: WEIGHT,
    contribution: score * WEIGHT,
    available: true,
    reason:
      minDistance <= 8
        ? `Listing image is very close to reference "${best.referenceTitle}" (${best.bestHashKind}).`
        : minDistance <= 14
          ? `Listing image has moderate similarity to reference "${best.referenceTitle}" (${best.bestHashKind}).`
          : "Listing image is not especially close to the reference set.",
    raw: {
      phash: listingHashes.phash,
      ahash: listingHashes.ahash,
      dhash: listingHashes.dhash,
      minHammingDistance: minDistance,
      matchedReferenceId: best.referenceId,
      matchedReferenceTitle: best.referenceTitle,
      bestHashKind: best.bestHashKind,
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
      phash: null,
      ahash: null,
      dhash: null,
      minHammingDistance: null,
      matchedReferenceId: null,
      matchedReferenceTitle: null,
      bestHashKind: null,
      allDistances: [],
    },
  };
}
