import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ReferenceItem } from "@/lib/types";
import { computeImageHashes } from "@/lib/scoring/phash";

let referenceCache: Promise<ReferenceItem[]> | null = null;

export async function loadReferenceSet() {
  if (!referenceCache) {
    referenceCache = loadReferenceSetFromDisk();
  }

  return referenceCache;
}

async function loadReferenceSetFromDisk() {
  const root = /* turbopackIgnore: true */ process.cwd();
  const referencePath = path.join(root, "data", "reference", "reference.json");
  const content = await readFile(referencePath, "utf8");
  const parsed = JSON.parse(content) as ReferenceItem[];

  return Promise.all(
    parsed.map(async (item) => {
      if (item.hashes) {
        return item;
      }

      // Lazy-compute hashes so contributors can drop a new image into
      // data/reference/images/ without having to re-run build:reference.
      const imageBuffer = await readFile(
        path.join(root, "data", "reference", "images", path.basename(item.imagePath)),
      );
      return {
        ...item,
        hashes: await computeImageHashes(imageBuffer),
      };
    }),
  );
}
