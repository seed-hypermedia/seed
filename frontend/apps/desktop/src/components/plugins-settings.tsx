import {
  useLoadedPlugins,
  useInstallPlugin,
  usePluginManifestPreview,
  useSetPluginEnabled,
  useUninstallPlugin,
  type LoadedPlugin,
} from '@/models/plugins'
import {RunActionPanel} from '@/plugins/run-action-panel'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {Switch} from '@shm/ui/components/switch'
import {parseCidString} from '@shm/ui/dag-json'
import {PLUGIN_PERMISSION_LABELS, validatePluginManifest, type PluginPermission} from '@shm/ui/plugin-manifest'
import {Separator} from '@shm/ui/separator'
import {Spinner} from '@shm/ui/spinner'
import {toast} from '@shm/ui/toast'
import {Play, Plus, Puzzle, ShieldCheck, Trash2, TriangleAlert} from 'lucide-react'
import {useMemo, useState} from 'react'
import {SettingsCard, SettingsRow} from '../pages/settings-ui'

/**
 * Plugin manager (Settings → Plugins): install by manifest ipfs:// URL with a
 * permission preview, enable/disable, and a developer "run action" surface
 * with the schema-driven input form. See docs/plugins/design.md.
 */
export function PluginsSettings() {
  const {plugins, isLoading} = useLoadedPlugins()
  return (
    <>
      <SettingsCard label="PLUGINS">
        <SettingsRow
          label="Sandboxed plugins"
          description="Plugins are content-addressed blobs running in a locked-down sandbox. They can only do what their manifest declares."
        />
        <Separator />
        <InstallPluginRow />
        {isLoading && <Spinner />}
        {plugins.map((plugin) => (
          <PluginRow key={plugin.cid} plugin={plugin} />
        ))}
        {!isLoading && plugins.length === 0 && (
          <SettingsRow
            label="No plugins installed"
            description="Paste a plugin manifest ipfs:// URL above to install one."
          />
        )}
      </SettingsCard>
    </>
  )
}

function InstallPluginRow() {
  const [text, setText] = useState('')
  const cidText = text.trim().replace(/^ipfs:\/\//, '')
  const validCid = !!parseCidString(cidText) && cidText.length > 0
  const preview = usePluginManifestPreview(validCid ? cidText : undefined)
  const install = useInstallPlugin()

  const manifest = useMemo(() => {
    const value = (preview.data as {value?: unknown} | undefined)?.value
    if (value === undefined) return null
    return validatePluginManifest(value)
  }, [preview.data])

  return (
    <div className="flex flex-col gap-2 py-2">
      <div className="flex items-center gap-2">
        <Input
          value={text}
          placeholder="Plugin manifest CID or ipfs:// URL"
          className="min-w-64 flex-1 font-mono text-xs"
          onChange={(e) => setText(e.target.value)}
        />
        <Button
          size="sm"
          disabled={!manifest || 'errors' in manifest}
          onClick={() => {
            if (!manifest || 'errors' in manifest) return
            install.mutate(
              {cid: cidText, grantedPermissions: manifest.manifest.permissions ?? []},
              {
                onSuccess: () => {
                  toast.success(`Installed ${manifest.manifest.title ?? manifest.manifest.name}`)
                  setText('')
                },
              },
            )
          }}
        >
          <Plus className="size-4" />
          Install
        </Button>
      </div>
      {validCid && preview.isLoading && <p className="text-muted-foreground text-xs">Fetching manifest…</p>}
      {manifest && 'errors' in manifest && (
        <div className="text-destructive text-xs">
          Not a valid plugin manifest: {manifest.errors.slice(0, 3).join('; ')}
        </div>
      )}
      {manifest && 'manifest' in manifest && (
        <div className="border-border flex flex-col gap-1 rounded-md border border-dashed p-3 text-sm">
          <span className="font-medium">{manifest.manifest.title ?? manifest.manifest.name}</span>
          {manifest.manifest.description && (
            <span className="text-muted-foreground text-xs">{manifest.manifest.description}</span>
          )}
          <PermissionList permissions={manifest.manifest.permissions ?? []} />
          <span className="text-muted-foreground text-xs">
            {manifest.manifest.actions.length} action{manifest.manifest.actions.length === 1 ? '' : 's'}:{' '}
            {manifest.manifest.actions.map((action) => action.name).join(', ')}
          </span>
        </div>
      )}
    </div>
  )
}

function PermissionList({permissions}: {permissions: PluginPermission[] | string[]}) {
  if (permissions.length === 0) {
    return (
      <span className="text-muted-foreground flex items-center gap-1 text-xs">
        <ShieldCheck className="size-3.5 text-green-600" />
        No permissions — fully isolated
      </span>
    )
  }
  return (
    <div className="flex flex-col gap-0.5">
      {permissions.map((permission) => (
        <span key={permission} className="text-muted-foreground flex items-center gap-1 text-xs">
          <ShieldCheck className="size-3.5 text-amber-600" />
          {PLUGIN_PERMISSION_LABELS[permission as PluginPermission] ?? permission}
        </span>
      ))}
    </div>
  )
}

function PluginRow({plugin}: {plugin: LoadedPlugin}) {
  const setEnabled = useSetPluginEnabled()
  const uninstall = useUninstallPlugin()
  const [runningAction, setRunningAction] = useState<string | null>(null)
  const manifest = plugin.manifest
  return (
    <div className="flex flex-col gap-2 py-2">
      <div className="flex items-center gap-2">
        <Puzzle className="text-muted-foreground size-4 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">
            {manifest?.title ?? manifest?.name ?? (plugin.isLoading ? 'Loading…' : plugin.cid)}
          </span>
          {manifest?.description && (
            <span className="text-muted-foreground truncate text-xs">{manifest.description}</span>
          )}
          {plugin.manifestErrors && (
            <span className="text-destructive flex items-center gap-1 text-xs">
              <TriangleAlert className="size-3" />
              Invalid manifest: {plugin.manifestErrors[0]}
            </span>
          )}
        </div>
        <Switch checked={plugin.enabled} onCheckedChange={(enabled) => setEnabled.mutate({cid: plugin.cid, enabled})} />
        <Button
          variant="ghost"
          size="iconSm"
          aria-label="Uninstall plugin"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => uninstall.mutate({cid: plugin.cid})}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
      {manifest && plugin.enabled && (
        <div className="flex flex-col gap-1 pl-6">
          <PermissionList permissions={manifest.permissions ?? []} />
          <div className="flex flex-wrap gap-1">
            {manifest.actions.map((action) => (
              <Button
                key={action.name}
                variant="outline"
                size="sm"
                className="h-6 gap-1 px-2 text-xs"
                onClick={() => setRunningAction(runningAction === action.name ? null : action.name)}
              >
                <Play className="size-3" />
                {action.title ?? action.name}
              </Button>
            ))}
          </div>
          {runningAction && (
            <RunActionPanel
              key={runningAction}
              manifest={manifest}
              actionName={runningAction}
              onClose={() => setRunningAction(null)}
            />
          )}
        </div>
      )}
    </div>
  )
}
