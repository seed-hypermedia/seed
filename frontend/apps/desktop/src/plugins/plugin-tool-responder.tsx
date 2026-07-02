import {useLoadedPlugins, usePluginToolRegistration, type LoadedPlugin} from '@/models/plugins'
import {PluginHost} from '@/plugins/plugin-host'
import {client} from '@/trpc'
import {useListenAppEvent} from '@/utils/window-events'
import {useUniversalClient} from '@shm/shared'
import {DAEMON_FILE_URL} from '@shm/shared/constants'
import {parsePluginToolName, type PluginManifest} from '@shm/ui/plugin-manifest'
import {useCallback, useEffect, useRef} from 'react'
import {createDesktopPluginBridge} from './desktop-plugin-bridge'

/**
 * App-wide responder that runs assistant-invoked plugin actions in the renderer
 * sandbox (see docs/plugins/design.md §5, Phase A). The main process dispatches
 * a `pluginToolRequest` to the focused window; this component resolves the
 * plugin, runs the action in a per-plugin PluginHost, wires the permission
 * bridge (blob + current-document capabilities), and returns the result to the
 * awaiting `execute` via `plugins.submitToolResult`. Exactly one reply per
 * request. Mount once, inside the navigation + universal-client context.
 */
export function PluginToolResponder() {
  // Registering enabled plugins' tools with main lives here so the whole plugin
  // tool lifecycle has a single mount point.
  usePluginToolRegistration()

  const {plugins} = useLoadedPlugins()
  const universalClient = useUniversalClient()

  // The event handler is stable; it reads the latest values through refs so it
  // never needs to re-subscribe (which would drop in-flight sandbox state).
  const pluginsRef = useRef<LoadedPlugin[]>(plugins)
  const clientRef = useRef(universalClient)
  pluginsRef.current = plugins
  clientRef.current = universalClient

  // Per-plugin sandbox hosts (reused across calls) and a code-blob fetch cache.
  const hostsRef = useRef<Map<string, Promise<PluginHost>>>(new Map())
  const codeCacheRef = useRef<Map<string, Promise<string>>>(new Map())

  const loadCode = useCallback((codeCid: string): Promise<string> => {
    let promise = codeCacheRef.current.get(codeCid)
    if (!promise) {
      promise = fetch(`${DAEMON_FILE_URL}/${codeCid}`).then(async (response) => {
        if (!response.ok) throw new Error(`Failed to fetch plugin code (${response.status})`)
        return response.text()
      })
      codeCacheRef.current.set(codeCid, promise)
    }
    return promise
  }, [])

  const getHost = useCallback(
    (plugin: LoadedPlugin & {manifest: PluginManifest}): Promise<PluginHost> => {
      const existing = hostsRef.current.get(plugin.cid)
      if (existing) return existing
      const created = loadCode(plugin.manifest.code['/']).then((code) => {
        const bridge = createDesktopPluginBridge(clientRef.current)
        return new PluginHost(plugin.manifest, code, bridge)
      })
      hostsRef.current.set(plugin.cid, created)
      // If code loading fails, drop the entry so a later call can retry.
      created.catch(() => hostsRef.current.delete(plugin.cid))
      return created
    },
    [loadCode],
  )

  const handleRequest = useCallback(
    async (event: {requestId: string; toolName: string; input: unknown}) => {
      const reply = (result: {output?: unknown; error?: string}) =>
        client.plugins.submitToolResult.mutate({requestId: event.requestId, ...result}).catch(() => {})
      try {
        const parsed = parsePluginToolName(event.toolName)
        if (!parsed) {
          await reply({error: `Unknown plugin tool: ${event.toolName}`})
          return
        }
        const plugin = pluginsRef.current.find(
          (candidate) => candidate.enabled && candidate.manifest?.name === parsed.pluginName,
        )
        if (!plugin?.manifest) {
          await reply({error: `Plugin "${parsed.pluginName}" is not installed or not enabled`})
          return
        }
        const action = plugin.manifest.actions.find((candidate) => candidate.name === parsed.actionName)
        if (!action) {
          await reply({error: `Plugin "${parsed.pluginName}" has no action "${parsed.actionName}"`})
          return
        }
        const host = await getHost(plugin as LoadedPlugin & {manifest: PluginManifest})
        const output = await host.invoke(parsed.actionName, event.input)
        await reply({output})
      } catch (error) {
        await reply({error: error instanceof Error ? error.message : String(error)})
      }
    },
    [getHost],
  )

  useListenAppEvent('pluginToolRequest', handleRequest)

  // Tear down hosts for plugins that are no longer enabled/installed, and all of
  // them on unmount, so a disabled plugin can't keep a live sandbox.
  const enabledCids = plugins
    .filter((plugin) => plugin.enabled && plugin.manifest)
    .map((plugin) => plugin.cid)
    .join(',')
  useEffect(() => {
    const live = new Set(enabledCids ? enabledCids.split(',') : [])
    for (const [cid, hostPromise] of Array.from(hostsRef.current.entries())) {
      if (!live.has(cid)) {
        hostsRef.current.delete(cid)
        void hostPromise.then((host) => host.destroy()).catch(() => {})
      }
    }
  }, [enabledCids])

  useEffect(() => {
    const hosts = hostsRef.current
    return () => {
      for (const hostPromise of Array.from(hosts.values())) {
        void hostPromise.then((host: PluginHost) => host.destroy()).catch(() => {})
      }
      hosts.clear()
    }
  }, [])

  return null
}
