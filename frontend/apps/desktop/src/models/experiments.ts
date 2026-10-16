import {client} from '@/trpc'
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

/**
 * Whether websites open in the integrated browser, read when a link is opened. Link openers use
 * this instead of `useExperiments` so rendering a link never requires a query provider.
 */
export async function readWebBrowserEnabled(): Promise<boolean> {
  try {
    const experiments = await queryClient.fetchQuery({
      queryKey: [queryKeys.EXPERIMENTS],
      queryFn: () => client.experiments.get.query(),
    })
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
      console.log('onSuccess')
      invalidateQueries([queryKeys.EXPERIMENTS])
    },
  })
  return writeExperiments
}
