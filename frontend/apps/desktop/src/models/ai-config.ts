import {client} from '@/trpc'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useMutation, useQuery} from '@tanstack/react-query'
import {toast} from '@shm/ui/toast'

export function useAIConfig() {
  return useQuery({
    queryKey: [queryKeys.AI_CONFIG],
    queryFn: () => client.aiConfig.get.query(),
  })
}

export function useSetAIConfigValue() {
  return useMutation({
    mutationFn: (input: {path: string; value: any}) => client.aiConfig.setValue.mutate(input),
    onError() {
      toast.error('Could not save AI config')
    },
    onSuccess() {
      invalidateQueries([queryKeys.AI_CONFIG])
    },
  })
}
