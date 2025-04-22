export async function tryUntilSuccess(
  fn: () => Promise<boolean>,
  retryDelayMs: number = 1_000,
  maxRetryMs: number = 10_000,
) {
  const startTime = Date.now()
  let didResolve = false
  let didTimeout = false
  while (!didResolve) {
    const result = await fn()
    if (result) {
      didResolve = true
    } else {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
    }
    if (Date.now() - startTime > maxRetryMs) {
      didTimeout = true
    }
  }
  if (didTimeout) {
    throw new Error('Timed out')
  }
}
