import {trpc} from '@/trpc'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {toast} from '@shm/ui/toast'

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
