/** Splits a large import into batches, so no single database call runs long. */
export function batches<T>(items: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Adds up the counts that each batch returns. */
export function addCounts<T extends Record<string, number>>(results: T[]): T {
  const total = {} as Record<string, number>;
  for (const result of results) {
    for (const [key, value] of Object.entries(result)) total[key] = (total[key] ?? 0) + value;
  }
  return total as T;
}
