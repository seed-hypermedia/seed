import {trpc} from '@/trpc'
import {invalidateQueries} from '@shm/shared'
import {toast} from '@shm/ui'

export function useExperiments() {
  const experiments = trpc.experiments.get.useQuery()
  return experiments
}

export function useWriteExperiments() {
  const writeExperiments = trpc.experiments.write.useMutation({
    onError() {
      toast.error('Could not save this change')
    },
    onSuccess() {
      console.log('onSuccess')
      invalidateQueries(['trpc.experiments.get'])
    },
  })
  return writeExperiments
}

export function useHasDevTools() {
  return !!useExperiments().data?.developerTools
}
