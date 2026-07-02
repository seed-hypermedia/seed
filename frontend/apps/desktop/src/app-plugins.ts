import {z} from 'zod'
// @ts-expect-error ignore this import error
import {appStore} from './app-store.mts'
import {t} from './app-trpc'

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
})
