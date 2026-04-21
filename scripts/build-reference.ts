import {
  mkdir,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { computeImageHashes } from "../src/lib/scoring/phash";
import { median, normalizeText } from "../src/lib/scoring/shared";
import type { ReferenceItem } from "../src/lib/types";

type CollectionItem = {
  id: string;
  title: string;
  url: string;
  imageUrl: string;
  category: string;
  prices: number[];
};

const root = process.cwd();
const imageDir = path.join(root, "data", "reference", "images");
const outputPath = path.join(root, "data", "reference", "reference.json");
const TARGET_COUNT = 8;
const PREFERRED_TITLES = [
  "Tranquil Hoodie",
  "Airplane Mode Travel Zip Hoodie",
  "Cloud Zip Hoodie",
  "Basic Quarter Zip Mock Neck",
  "Love Hoodie",
  "Pastel Zip Hoodie",
  "Camo Zip Hoodie",
  "Affirmation Zip Hoodie",
];

function slugify(value: string) {
  return normalizeText(value).replace(/\s+/g, "_");
}

async function ensureCleanImageDirectory() {
  await mkdir(imageDir, { recursive: true });
  const entries = await readdir(imageDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === ".gitkeep") {
      continue;
    }

    await rm(path.join(imageDir, entry.name), {
      recursive: true,
      force: true,
    });
  }
}

async function downloadImageBuffer(imageUrl: string) {
  const response = await fetch(imageUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to download reference image: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const extension = contentType.includes("png")
    ? "png"
    : contentType.includes("webp")
      ? "webp"
      : "jpg";

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    extension,
  };
}

function chooseReferenceItems(items: CollectionItem[]) {
  const byTitle = new Map(
    items.map((item) => [normalizeText(item.title), item] as const),
  );
  const selected: CollectionItem[] = [];
  const seen = new Set<string>();

  for (const preferredTitle of PREFERRED_TITLES) {
    const item = byTitle.get(normalizeText(preferredTitle));
    if (item && !seen.has(item.id)) {
      selected.push(item);
      seen.add(item.id);
    }
  }

  for (const item of items) {
    if (selected.length >= TARGET_COUNT) {
      break;
    }

    if (!seen.has(item.id)) {
      selected.push(item);
      seen.add(item.id);
    }
  }

  return selected.slice(0, TARGET_COUNT);
}

async function loadCollectionItems() {
  const response = await fetch("https://comfrt.com/collections/hoodies");
  if (!response.ok) {
    throw new Error(`Failed to load Comfrt collection page: ${response.status}`);
  }

  const html = await response.text();
  const matches = Array.from(
    html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
  );
  const rawItemList = matches
    .map((match) => match[1].trim())
    .find((candidate) => candidate.includes('"@type":"ItemList"'));

  if (!rawItemList) {
    throw new Error("Unable to find ItemList JSON-LD on Comfrt collection page.");
  }

  const itemList = JSON.parse(rawItemList) as {
    itemListElement?: Array<{
      item?: { name?: string; url?: string; image?: string };
      category?: string;
      image?: string;
      offers?: Array<{ price?: number | string }>;
    }>;
  };

  return (itemList.itemListElement ?? []).map((item) => {
    const title = item.item?.name ?? "";
    const url = item.item?.url ?? "";
    const prices = (item.offers ?? [])
      .map((offer) =>
        typeof offer.price === "number"
          ? offer.price
          : Number.parseFloat(String(offer.price)),
      )
      .filter((price) => Number.isFinite(price));

    return {
      id:
        url.split("/products/")[1]?.split("?")[0] ||
        slugify(title),
      title,
      url,
      imageUrl: item.item?.image ?? item.image ?? "",
      category: item.category ?? "Hoodie",
      prices,
    } satisfies CollectionItem;
  });
}

async function main() {
  const liveItems = await loadCollectionItems();
  const selectedItems = chooseReferenceItems(liveItems);

  if (selectedItems.length < TARGET_COUNT) {
    throw new Error(
      `Unable to build ${TARGET_COUNT} reference items from the live Comfrt collection.`,
    );
  }

  await ensureCleanImageDirectory();

  const references: ReferenceItem[] = [];

  for (const item of selectedItems) {
    const { buffer, extension } = await downloadImageBuffer(item.imageUrl);
    const filename = `${slugify(item.title)}.${extension}`;
    const imagePath = path.posix.join("data", "reference", "images", filename);
    await writeFile(path.join(root, imagePath), buffer);

    references.push({
      id: item.id,
      title: item.title,
      category: item.category,
      url: item.url,
      imageUrl: item.imageUrl,
      imagePath,
      minPrice: item.prices.length > 0 ? Math.min(...item.prices) : null,
      maxPrice: item.prices.length > 0 ? Math.max(...item.prices) : null,
      medianPrice: median(item.prices),
      hashes: await computeImageHashes(buffer),
    });
  }

  await writeFile(outputPath, JSON.stringify(references, null, 2));
  process.stdout.write(`Wrote ${references.length} reference items to ${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
