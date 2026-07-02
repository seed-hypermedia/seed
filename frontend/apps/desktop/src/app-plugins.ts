import {z} from 'zod'
// @ts-expect-error ignore this import error
import {appStore} from './app-store.mts'
import {t} from './app-trpc'
import {createPendingToolCalls} from './plugins/pending-tool-calls'
import type {PluginToolDescriptor} from './plugins/plugin-tool-descriptors'

/**
 * Installed-plugin persistence (main process). A plugin is identified by its
 * manifest CID; the manifest itself lives in IPFS and is fetched/validated
 * renderer-side (models/plugins.ts). Installing records the CID; `enabled`
 * gates sandbox spawning and agent-tool exposure.
 */

const PLUGINS_STORAGE_KEY = 'Plugins-v001'

const installedPluginSchema = z.object({
  cid: z.string(),
  enabled: z.boolean(),
  /** Manifest permissions at install time, for display and change detection. */
  grantedPermissions: z.array(z.string()).optional(),
})
export type InstalledPlugin = z.infer<typeof installedPluginSchema>

const pluginsStateSchema = z.object({
  installed: z.array(installedPluginSchema),
})
export type PluginsState = z.infer<typeof pluginsStateSchema>

let pluginsState: PluginsState = (() => {
  const stored = appStore.get(PLUGINS_STORAGE_KEY)
  const parsed = pluginsStateSchema.safeParse(stored)
  return parsed.success ? parsed.data : {installed: []}
})()

function writeState(next: PluginsState) {
  pluginsState = next
  appStore.set(PLUGINS_STORAGE_KEY, next)
}

/**
 * Assistant tool descriptors for the currently enabled plugins. Registered by
 * the focused renderer (which owns the manifests + compiled schemas) and read
 * by app-chat.ts when it builds the per-request tool set. Volatile module state
 * — never persisted; the renderer re-registers on every relevant change.
 */
let registeredTools: PluginToolDescriptor[] = []

export function getRegisteredPluginTools(): PluginToolDescriptor[] {
  return registeredTools
}

/**
 * In-flight plugin tool calls awaiting a sandbox result. Shared between
 * app-chat's `execute` (which registers a request and awaits it) and the
 * `submitToolResult` mutation below (which settles it). 60s matches the
 * assistant's per-tool patience before it gives up on a runaway plugin.
 */
export const pluginToolCalls = createPendingToolCalls(60_000)

const pluginToolDescriptorSchema = z.object({
  toolName: z.string(),
  pluginCid: z.string(),
  actionName: z.string(),
  description: z.string(),
  // Compiled plain JSON Schema; shape is validated by the AI SDK at use time.
  inputSchema: z.record(z.string(), z.unknown()),
})

export const pluginsApi = t.router({
  get: t.procedure.query(async () => {
    return pluginsState
  }),
  install: t.procedure.input(installedPluginSchema).mutation(async ({input}) => {
    const existing = pluginsState.installed.filter((plugin) => plugin.cid !== input.cid)
    writeState({installed: [...existing, input]})
  }),
  setEnabled: t.procedure.input(z.object({cid: z.string(), enabled: z.boolean()})).mutation(async ({input}) => {
    writeState({
      installed: pluginsState.installed.map((plugin) =>
        plugin.cid === input.cid ? {...plugin, enabled: input.enabled} : plugin,
      ),
    })
  }),
  uninstall: t.procedure.input(z.object({cid: z.string()})).mutation(async ({input}) => {
    writeState({installed: pluginsState.installed.filter((plugin) => plugin.cid !== input.cid)})
  }),
  /** Replace the full set of assistant tool descriptors (replace-all semantics). */
  registerTools: t.procedure.input(z.array(pluginToolDescriptorSchema)).mutation(async ({input}) => {
    registeredTools = input as PluginToolDescriptor[]
  }),
  /** Deliver a sandbox tool result back to the awaiting assistant `execute`. */
  submitToolResult: t.procedure
    .input(z.object({requestId: z.string(), output: z.unknown().optional(), error: z.string().optional()}))
    .mutation(async ({input}) => {
      if (input.error !== undefined) {
        pluginToolCalls.reject(input.requestId, input.error)
      } else {
        pluginToolCalls.resolve(input.requestId, input.output)
      }
    }),
})
