import {buildPluginToolDescriptors, type PluginToolSource} from '@/plugins/plugin-tool-descriptors'
import {client} from '@/trpc'
import {useUniversalClient} from '@shm/shared'
import {DAEMON_FILE_URL} from '@shm/shared/constants'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {compileBlobSchemaForLLM} from '@shm/ui/blob-schema-compile'
import {useSchemaRegistries} from '@shm/ui/blob-schema-registry'
import {validatePluginManifest, type PluginManifest} from '@shm/ui/plugin-manifest'
import {useMutation, useQueries, useQuery} from '@tanstack/react-query'
import {toast} from '@shm/ui/toast'
import {useEffect, useMemo, useRef} from 'react'

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

/**
 * Register the enabled plugins' actions as assistant tools with the main
 * process. Runs where manifests and schemas already live (renderer): it fetches
 * each action's input schema closure, lowers it to plain JSON Schema for the
 * model, and pushes the full descriptor list to `plugins.registerTools`
 * (replace-all). Re-registers only when the serialized descriptors change, so
 * schema convergence or enable/disable propagates without mutation loops.
 *
 * Mount once, app-wide (see PluginToolResponder).
 */
export function usePluginToolRegistration() {
  const {plugins} = useLoadedPlugins()

  const enabled = useMemo(
    () =>
      plugins.filter(
        (plugin): plugin is typeof plugin & {manifest: PluginManifest} => plugin.enabled && !!plugin.manifest,
      ),
    [plugins],
  )

  // Every input-schema CID across all enabled plugins, fetched as one closure.
  const inputCids = useMemo(() => {
    const cids = new Set<string>()
    for (const plugin of enabled) {
      for (const action of plugin.manifest.actions) {
        const cid = action.input?.['/']
        if (cid) cids.add(cid)
      }
    }
    return Array.from(cids)
  }, [enabled])

  const {registry} = useSchemaRegistries(inputCids)

  const descriptors = useMemo(() => {
    const sources: PluginToolSource[] = enabled.map((plugin) => {
      const inputSchemas: Record<string, ReturnType<typeof compileBlobSchemaForLLM> | undefined> = {}
      for (const action of plugin.manifest.actions) {
        const cid = action.input?.['/']
        const schema = cid ? registry[cid] : undefined
        inputSchemas[action.name] = schema ? compileBlobSchemaForLLM(schema, registry) : undefined
      }
      return {cid: plugin.cid, manifest: plugin.manifest, inputSchemas}
    })
    return buildPluginToolDescriptors(sources)
  }, [enabled, registry])

  const lastRegistered = useRef<string | null>(null)
  useEffect(() => {
    const serialized = JSON.stringify(descriptors)
    if (serialized === lastRegistered.current) return
    lastRegistered.current = serialized
    client.plugins.registerTools.mutate(descriptors).catch(() => {})
  }, [descriptors])
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
