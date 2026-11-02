/** Calculate the ordering key once per card; stable sort preserves equal timestamps. */
export function sortNewestFirst<T>(items: readonly T[], timestamp: (item: T) => number): T[] {
  return items.map(item => ({ item, time: timestamp(item) }))
    .sort((a, b) => b.time - a.time)
    .map(({ item }) => item);
}
