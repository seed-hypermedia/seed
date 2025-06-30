export async function tryUntilSuccess<Result>(
  fn: () => Promise<Result | null>,
  {
    retryDelayMs = 1_000,
    maxRetryMs = 10_000,
    immediateCatch,
  }: {
    retryDelayMs?: number
    maxRetryMs?: number
    immediateCatch?: (error: unknown) => boolean
  } = {},
): Promise<Result> {
  const startTime = Date.now()
  let resolution: Result | null = null
  let didTimeout = false
  while (!resolution && !didTimeout) {
    try {
      // console.log('attempting', fn)
      const result = await fn()
      if (result) {
        resolution = result
      }
    } catch (error) {
      if (immediateCatch?.(error)) {
        throw error
      }
      // console.log('swallowing error', error)
    }
    if (!resolution) {
      if (Date.now() - startTime > maxRetryMs) {
        didTimeout = true
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
    }
  }
  if (didTimeout) {
    throw new Error('Timed out')
  }
  if (!resolution) {
    throw new Error('Failed to resolve')
  }
  return resolution
}
