import {client} from '@/trpc'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useMutation, useQuery} from '@tanstack/react-query'
import {toast} from '@shm/ui/toast'

// Legacy hooks (kept for backward compat)

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

// Provider hooks

function invalidateProviderQueries() {
  invalidateQueries([queryKeys.AI_PROVIDERS])
  invalidateQueries([queryKeys.AI_SELECTED_PROVIDER])
  invalidateQueries([queryKeys.AI_CONFIG])
}

export function useAIProviders() {
  return useQuery({
    queryKey: [queryKeys.AI_PROVIDERS],
    queryFn: () => client.aiConfig.listProviders.query(),
  })
}

export function useAIProvider(id: string | null) {
  return useQuery({
    queryKey: [queryKeys.AI_PROVIDERS, id],
    queryFn: () => client.aiConfig.getProvider.query(id!),
    enabled: !!id,
  })
}

export function useSelectedProvider() {
  return useQuery({
    queryKey: [queryKeys.AI_SELECTED_PROVIDER],
    queryFn: () => client.aiConfig.getSelectedProvider.query(),
  })
}

export function useAddProvider() {
  return useMutation({
    mutationFn: (input: {
      type: 'openai' | 'anthropic' | 'ollama'
      label?: string
      model?: string
      apiKey?: string
      baseUrl?: string
    }) => client.aiConfig.addProvider.mutate(input),
    onError() {
      toast.error('Could not add provider')
    },
    onSuccess() {
      invalidateProviderQueries()
    },
  })
}

export function useUpdateProvider() {
  return useMutation({
    mutationFn: (input: {
      id: string
      label?: string
      type?: 'openai' | 'anthropic' | 'ollama'
      model?: string
      apiKey?: string
      baseUrl?: string
    }) => client.aiConfig.updateProvider.mutate(input),
    onError() {
      toast.error('Could not update provider')
    },
    onSuccess() {
      invalidateProviderQueries()
    },
  })
}

export function useDuplicateProvider() {
  return useMutation({
    mutationFn: (id: string) => client.aiConfig.duplicateProvider.mutate(id),
    onError() {
      toast.error('Could not duplicate provider')
    },
    onSuccess() {
      invalidateProviderQueries()
    },
  })
}

export function useDeleteProvider() {
  return useMutation({
    mutationFn: (id: string) => client.aiConfig.deleteProvider.mutate(id),
    onError() {
      toast.error('Could not delete provider')
    },
    onSuccess() {
      invalidateProviderQueries()
    },
  })
}

export function useSetSelectedProvider() {
  return useMutation({
    mutationFn: (id: string) => client.aiConfig.setSelectedProvider.mutate(id),
    onError() {
      toast.error('Could not set selected provider')
    },
    onSuccess() {
      invalidateProviderQueries()
    },
  })
}

export function useLastUsedProviderId() {
  return useQuery({
    queryKey: [queryKeys.AI_LAST_USED_PROVIDER],
    queryFn: () => client.aiConfig.getLastUsedProviderId.query(),
  })
}

export function useOllamaModels(baseUrl: string | null) {
  return useQuery({
    queryKey: [queryKeys.OLLAMA_MODELS, baseUrl],
    queryFn: () => client.aiConfig.listOllamaModels.query(baseUrl!),
    enabled: !!baseUrl,
  })
}
