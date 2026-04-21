const STOP_WORDS = new Set([
  "and",
  "for",
  "the",
  "with",
  "new",
  "now",
  "men",
  "mens",
  "women",
  "womens",
  "unisex",
  "pullover",
  "sweatshirt",
  "hooded",
]);

export function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(value: string) {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token && !STOP_WORDS.has(token));
}

export function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

export function levenshtein(a: string, b: string) {
  if (a === b) {
    return 0;
  }

  const matrix = Array.from({ length: a.length + 1 }, () =>
    Array<number>(b.length + 1).fill(0),
  );

  for (let i = 0; i <= a.length; i += 1) {
    matrix[i][0] = i;
  }

  for (let j = 0; j <= b.length; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}

export function median(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

export function clamp(value: number, min = 0, max = 1) {
  return Math.min(Math.max(value, min), max);
}
