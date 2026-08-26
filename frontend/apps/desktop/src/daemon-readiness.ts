import {State} from '@shm/shared/client/.generated/daemon/v1alpha/daemon_pb'

type DaemonTask = {
  completed: bigint | number
  total: bigint | number
}

type DaemonInfo = {
  state: State
  tasks: DaemonTask[]
}

type DaemonState = {t: 'ready'} | {t: 'migrating'; completed: number; total: number}

export async function waitForDaemonActive<TInfo extends DaemonInfo>({
  getInfo,
  onDaemonState,
  onLogDebug,
  onLogInfo,
  retryDelayMs = 200,
  startupTimeoutMs = 10 * 60 * 1_000,
  migrationStallTimeoutMs = 20 * 60 * 1_000,
  now = Date.now,
  sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
}: {
  getInfo: () => Promise<TInfo>
  onDaemonState: (state: DaemonState) => void
  onLogDebug?: (message: string) => void
  onLogInfo?: (message: string) => void
  retryDelayMs?: number
  startupTimeoutMs?: number
  migrationStallTimeoutMs?: number
  now?: () => number
  sleep?: (delay: number) => Promise<void>
}): Promise<TInfo> {
  const startupStartedAt = now()
  let lastMigrationProgressAt = now()
  let lastMigrationCompleted: number | undefined

  while (true) {
    try {
      onLogDebug?.('Waiting for daemon to boot...')
      const info = await getInfo()

      if (info.state === State.ACTIVE) {
        onDaemonState({t: 'ready'})
        return info
      }

      if (info.state === State.MIGRATING && info.tasks.length === 1) {
        const completed = Number(info.tasks[0].completed)
        const total = Number(info.tasks[0].total)

        onLogInfo?.(`Daemon migrating: ${completed}/${total}`)
        onDaemonState({t: 'migrating', completed, total})

        if (lastMigrationCompleted !== completed) {
          lastMigrationCompleted = completed
          lastMigrationProgressAt = now()
        }

        if (now() - lastMigrationProgressAt > migrationStallTimeoutMs) {
          throw new Error(`Daemon migration stalled at ${completed}/${total}`)
        }

        await sleep(retryDelayMs)
        continue
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Daemon migration stalled')) {
        throw error
      }
    }

    if (now() - startupStartedAt > startupTimeoutMs) {
      throw new Error('Timed out: waiting for daemon gRPC to be ready')
    }

    await sleep(retryDelayMs)
  }
}
