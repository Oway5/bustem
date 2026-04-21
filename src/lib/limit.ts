export function createLimiter(concurrency: number) {
  let activeCount = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    activeCount -= 1;
    const run = queue.shift();
    if (run) {
      run();
    }
  };

  return async function limit<T>(task: () => Promise<T>) {
    if (activeCount >= concurrency) {
      await new Promise<void>((resolve) => {
        queue.push(resolve);
      });
    }

    activeCount += 1;

    try {
      return await task();
    } finally {
      next();
    }
  };
}
