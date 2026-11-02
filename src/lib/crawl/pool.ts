/** Run `worker` over `items` with at most `concurrency` in flight. */
export async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<unknown>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}
