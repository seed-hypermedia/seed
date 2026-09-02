import {client} from '@/trpc'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {toast} from '@shm/ui/toast'
import {useMutation, useQuery} from '@tanstack/react-query'

/** Renderer hooks for the desktop service manager. Live updates arrive as query invalidation from main. */

export type ServiceInfo = Awaited<ReturnType<typeof client.services.list.query>>[number]
export type ServiceLogLine = Awaited<ReturnType<typeof client.services.logs.query>>['lines'][number]
export type ServiceInput = Parameters<typeof client.services.create.mutate>[0]

export function useServices() {
  return useQuery({
    queryKey: [queryKeys.SERVICES],
    queryFn: () => client.services.list.query(),
    // Invalidation from main is the primary signal; polling covers a missed event.
    refetchInterval: 10_000,
  })
}

export function useServiceLogs(id: string | null, limit = 1000) {
  return useQuery({
    queryKey: [queryKeys.SERVICE_LOGS, id, limit],
    queryFn: () => client.services.logs.query({id: id!, limit}),
    enabled: Boolean(id),
    refetchInterval: 3_000,
  })
}

function refreshServices() {
  invalidateQueries([queryKeys.SERVICES])
}

function reportError(action: string) {
  return (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    toast.error(`Could not ${action}: ${message}`)
  }
}

export function useCreateService() {
  return useMutation({
    mutationFn: (input: ServiceInput & {start?: boolean}) => {
      const {start, ...definition} = input
      return client.services.create.mutate(definition).then(async (service) => {
        if (start) await client.services.start.mutate({id: service.id})
        return service
      })
    },
    onSuccess: refreshServices,
    onError: reportError('create the service'),
  })
}

export function useUpdateService() {
  return useMutation({
    mutationFn: (input: Parameters<typeof client.services.update.mutate>[0]) => client.services.update.mutate(input),
    onSuccess: refreshServices,
    onError: reportError('save the service'),
  })
}

export function useRemoveService() {
  return useMutation({
    mutationFn: (id: string) => client.services.remove.mutate({id}),
    onSuccess: refreshServices,
    onError: reportError('remove the service'),
  })
}

export type ServiceAction = 'start' | 'stop' | 'restart'

export function useServiceAction() {
  return useMutation({
    mutationFn: ({id, action}: {id: string; action: ServiceAction}) => client.services[action].mutate({id}),
    onSuccess: refreshServices,
    onError: (error, {action}) => reportError(`${action} the service`)(error),
  })
}

export function useClearServiceLogs() {
  return useMutation({
    mutationFn: (id: string) => client.services.clearLogs.mutate({id}),
    onSuccess: (_result, id) => invalidateQueries([queryKeys.SERVICE_LOGS, id]),
  })
}
