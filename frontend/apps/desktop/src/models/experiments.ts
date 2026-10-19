import {ipc} from '@/ipc'
import {client} from '@/trpc'
import type {AppWindowEvent} from '@/utils/window-events'
import {invalidateQueries, queryClient} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useMutation, useQuery} from '@tanstack/react-query'
import {toast} from '@shm/ui/toast'

export function useExperiments() {
  return useQuery({
    queryKey: [queryKeys.EXPERIMENTS],
    queryFn: () => client.experiments.get.query(),
  })
}

// The cache never expires on its own, so every window refreshes when any window writes the experiments.
if (typeof window !== 'undefined') {
  window.appWindowEvents?.subscribe((event: AppWindowEvent) => {
    if (event.type === 'experiments_changed') invalidateQueries([queryKeys.EXPERIMENTS])
  })
}

/**
 * Whether websites open in the integrated browser, asked of the main process when a link is opened.
 * Link openers use this instead of `useExperiments` so rendering a link never requires a query
 * provider, and so a toggle flipped in another window or the Chromium kill switch is honoured at
 * once instead of a cached answer. The answer also refreshes the cached experiments.
 */
export async function readWebBrowserEnabled(): Promise<boolean> {
  try {
    const experiments = await client.experiments.get.query()
    queryClient.setQueryData([queryKeys.EXPERIMENTS], experiments)
    return experiments?.webBrowser === true
  } catch {
    return false
  }
}

export function useWriteExperiments() {
  const writeExperiments = useMutation({
    mutationFn: (experiments: Parameters<typeof client.experiments.write.mutate>[0]) =>
      client.experiments.write.mutate(experiments),
    onError() {
      toast.error('Could not save this change')
    },
    onSuccess() {
      invalidateQueries([queryKeys.EXPERIMENTS])
      ipc.send('broadcastWindowEvent', {type: 'experiments_changed'} satisfies AppWindowEvent)
    },
  })
  return writeExperiments
}
