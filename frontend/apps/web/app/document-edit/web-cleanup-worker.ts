/** Serializes complete hydrate/run/stop sessions across tabs using the browser's exclusive lock. */
export function createWebCleanupWorker({
  locks,
  run,
  onError,
}: {
  locks: Pick<LockManager, 'request'>
  run: () => Promise<void>
  onError: (error: unknown) => void
}) {
  let requested = false
  let running: Promise<void> | null = null
  let stopped = false
  return {
    wake() {
      if (stopped) return Promise.resolve()
      requested = true
      if (!running) {
        running = (async () => {
          while (requested && !stopped) {
            requested = false
            await locks.request('seed-document-reference-maintenance', async () => {
              if (!stopped) await run()
            })
          }
        })()
          .catch(onError)
          .finally(() => {
            running = null
          })
      }
      return running
    },
    stop() {
      stopped = true
    },
  }
}
