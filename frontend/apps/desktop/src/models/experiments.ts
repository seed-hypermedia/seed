import {client} from '@/trpc'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useMutation, useQuery} from '@tanstack/react-query'
import {toast} from '@shm/ui/toast'

export function useExperiments() {
  return useQuery({
    queryKey: [queryKeys.EXPERIMENTS],
    queryFn: () => client.experiments.get.query(),
  })
}

export function useWriteExperiments() {
  const writeExperiments = useMutation({
    mutationFn: (
      experiments: Parameters<typeof client.experiments.write.mutate>[0],
    ) => client.experiments.write.mutate(experiments),
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
