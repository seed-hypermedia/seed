import {client} from '@/trpc'
import {useUniversalClient} from '@shm/shared'
import {DAEMON_FILE_URL} from '@shm/shared/constants'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {validatePluginManifest, type PluginManifest} from '@shm/ui/plugin-manifest'
import {useMutation, useQueries, useQuery} from '@tanstack/react-query'
import {toast} from '@shm/ui/toast'

/** Installed plugin records (CIDs + enabled flags) from the main process. */
export function useInstalledPlugins() {
  return useQuery({
    queryKey: [queryKeys.PLUGINS],
    queryFn: () => client.plugins.get.query(),
  })
}

export type LoadedPlugin = {
  cid: string
  enabled: boolean
  manifest?: PluginManifest
  manifestErrors?: string[]
  isLoading: boolean
}

/**
 * Installed plugins with their manifests fetched from IPFS and validated.
 * Manifests are immutable blobs — cached forever under the CID query key.
 */
export function useLoadedPlugins(): {plugins: LoadedPlugin[]; isLoading: boolean} {
  const installed = useInstalledPlugins()
  const universalClient = useUniversalClient()
  const records = installed.data?.installed ?? []
  const manifests = useQueries({
    queries: records.map((record) => ({
      queryKey: [queryKeys.CID, record.cid],
      queryFn: async () => universalClient.request('GetCID', {cid: record.cid}),
      staleTime: Infinity,
      useErrorBoundary: false,
      retry: false,
      refetchInterval: (data: unknown) => (data === undefined ? 15_000 : false),
    })),
  })
  const plugins = records.map((record, index) => {
    const query = manifests[index]
    const value = (query?.data as {value?: unknown} | undefined)?.value
    if (value === undefined) {
      return {cid: record.cid, enabled: record.enabled, isLoading: !!query?.isLoading}
    }
    const validated = validatePluginManifest(value)
    return 'manifest' in validated
      ? {cid: record.cid, enabled: record.enabled, manifest: validated.manifest, isLoading: false}
      : {cid: record.cid, enabled: record.enabled, manifestErrors: validated.errors, isLoading: false}
  })
  return {plugins, isLoading: installed.isLoading}
}

/** Fetch + validate a manifest by CID without installing (install preview). */
export function usePluginManifestPreview(cid: string | undefined) {
  const universalClient = useUniversalClient()
  return useQuery({
    queryKey: [queryKeys.CID, cid],
    enabled: !!cid,
    staleTime: Infinity,
    useErrorBoundary: false,
    queryFn: async () => universalClient.request('GetCID', {cid: cid!}),
  })
}

export function useInstallPlugin() {
  return useMutation({
    mutationFn: (input: {cid: string; grantedPermissions: string[]}) =>
      client.plugins.install.mutate({...input, enabled: true}),
    onSuccess: () => invalidateQueries([queryKeys.PLUGINS]),
    onError: () => toast.error('Could not install plugin'),
  })
}

export function useSetPluginEnabled() {
  return useMutation({
    mutationFn: (input: {cid: string; enabled: boolean}) => client.plugins.setEnabled.mutate(input),
    onSuccess: () => invalidateQueries([queryKeys.PLUGINS]),
  })
}

export function useUninstallPlugin() {
  return useMutation({
    mutationFn: (input: {cid: string}) => client.plugins.uninstall.mutate(input),
    onSuccess: () => invalidateQueries([queryKeys.PLUGINS]),
  })
}

/** Fetch a plugin's code blob (raw JS) by CID, as text. */
export function usePluginCode(codeCid: string | undefined) {
  return useQuery({
    queryKey: ['plugin-code', codeCid],
    enabled: !!codeCid,
    staleTime: Infinity,
    useErrorBoundary: false,
    queryFn: async () => {
      const response = await fetch(`${DAEMON_FILE_URL}/${codeCid}`)
      if (!response.ok) throw new Error(`Failed to fetch plugin code (${response.status})`)
      return await response.text()
    },
  })
}
