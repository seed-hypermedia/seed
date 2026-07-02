import {useLoadedPlugins, useInstallPlugin, usePluginCode, usePluginManifestPreview, useSetPluginEnabled, useUninstallPlugin, type LoadedPlugin} from '@/models/plugins'
import {createPluginBridge} from '@/plugins/plugin-bridge'
import {PluginHost} from '@/plugins/plugin-host'
import {useSchemaRegistry} from '@/models/blob-schema'
import {useUniversalClient} from '@shm/shared'
import {instantiateSchema, validateValue, type SchemaWarning} from '@shm/ui/blob-schema'
import {BlobSchemaProvider} from '@shm/ui/blob-schema-context'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {Switch} from '@shm/ui/components/switch'
import {dagJsonToIpld, parseCidString} from '@shm/ui/dag-json'
import {PLUGIN_PERMISSION_LABELS, validatePluginManifest, type PluginManifest, type PluginPermission} from '@shm/ui/plugin-manifest'
import {Separator} from '@shm/ui/separator'
import {Spinner} from '@shm/ui/spinner'
import {toast} from '@shm/ui/toast'
import {CBOR_VALUE_RULES, isPlainObject, ValueDisplay, ValueEditor, ValueEditorProvider} from '@shm/ui/value-editor'
import * as cbor from '@ipld/dag-cbor'
import {Play, Plus, Puzzle, ShieldCheck, Trash2, TriangleAlert} from 'lucide-react'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import {useMemo, useRef, useState} from 'react'
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
          <SettingsRow label="No plugins installed" description="Paste a plugin manifest ipfs:// URL above to install one." />
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
      {validCid && preview.isLoading && (
        <p className="text-muted-foreground text-xs">Fetching manifest…</p>
      )}
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
          {manifest?.description && <span className="text-muted-foreground truncate text-xs">{manifest.description}</span>}
          {plugin.manifestErrors && (
            <span className="text-destructive flex items-center gap-1 text-xs">
              <TriangleAlert className="size-3" />
              Invalid manifest: {plugin.manifestErrors[0]}
            </span>
          )}
        </div>
        <Switch
          checked={plugin.enabled}
          onCheckedChange={(enabled) => setEnabled.mutate({cid: plugin.cid, enabled})}
        />
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

/**
 * The invoke surface: schema-driven input form (auto-generated from the
 * action's input schema blob), sandboxed execution, output validated
 * (advisorily) against the output schema and rendered as structured data.
 */
function RunActionPanel({
  manifest,
  actionName,
  onClose,
}: {
  manifest: PluginManifest
  actionName: string
  onClose: () => void
}) {
  const universalClient = useUniversalClient()
  const action = manifest.actions.find((candidate) => candidate.name === actionName)
  const inputSchemaCid = action?.input?.['/']
  const outputSchemaCid = action?.output?.['/']
  const inputSchemas = useSchemaRegistry(inputSchemaCid)
  const outputSchemas = useSchemaRegistry(outputSchemaCid)
  const code = usePluginCode(manifest.code['/'])

  const [input, setInput] = useState<unknown>(undefined)
  const [state, setState] = useState<
    {phase: 'idle'} | {phase: 'running'} | {phase: 'done'; output: unknown} | {phase: 'failed'; message: string}
  >({phase: 'idle'})
  const hostRef = useRef<PluginHost | null>(null)

  // Seed the form once the input schema arrives.
  const inputSchema = inputSchemas.rootSchema
  const effectiveInput =
    input !== undefined ? input : inputSchema ? (instantiateSchema(inputSchema, inputSchemas.registry) ?? {}) : {}

  const outputWarnings: SchemaWarning[] =
    state.phase === 'done' && outputSchemas.rootSchema
      ? validateValue(state.output, outputSchemas.rootSchema, outputSchemas.registry)
      : []

  const run = async () => {
    if (!code.data) return
    setState({phase: 'running'})
    try {
      if (!hostRef.current) {
        const bridge = createPluginBridge({
          getBlob: async (cid) => {
            const result = (await universalClient.request('GetCID', {cid})) as {value?: unknown}
            return result.value
          },
          publishBlob: async (value) => {
            const data = cbor.encode(dagJsonToIpld(value))
            const digest = await sha256.digest(data)
            const cid = CID.createV1(0x71, digest).toString()
            await universalClient.request('PublishBlobs', {blobs: [{cid, data}]})
            return {cid}
          },
          // Document capabilities are wired when invoking from a document
          // context; the settings surface has no current document.
        })
        hostRef.current = new PluginHost(manifest, code.data, bridge)
      }
      const output = await hostRef.current.invoke(actionName, effectiveInput)
      setState({phase: 'done', output})
    } catch (error) {
      setState({phase: 'failed', message: error instanceof Error ? error.message : String(error)})
    }
  }

  return (
    <div className="border-border flex flex-col gap-3 rounded-md border border-dashed p-3">
      <span className="text-sm font-medium">{action?.title ?? actionName}</span>
      {action?.description && <span className="text-muted-foreground text-xs">{action.description}</span>}
      {inputSchemaCid && !inputSchema && (
        <span className="text-muted-foreground flex items-center gap-1 text-xs">
          <Spinner className="size-3" /> Loading input schema…
        </span>
      )}
      <ValueEditorProvider openUrl={() => {}}>
        <BlobSchemaProvider schema={inputSchema} registry={inputSchemas.registry} value={effectiveInput}>
          {isPlainObject(effectiveInput) || Array.isArray(effectiveInput) || effectiveInput !== undefined ? (
            <ValueEditor value={effectiveInput} onValue={setInput} rules={CBOR_VALUE_RULES} />
          ) : null}
        </BlobSchemaProvider>
      </ValueEditorProvider>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={state.phase === 'running' || !code.data} onClick={run}>
          {state.phase === 'running' ? <Spinner className="size-4" /> : <Play className="size-4" />}
          Run
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
        {!code.data && !code.isLoading && <span className="text-destructive text-xs">Plugin code not found</span>}
      </div>
      {state.phase === 'failed' && <p className="text-destructive text-xs">{state.message}</p>}
      {state.phase === 'done' && (
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs font-medium">Output</span>
          {outputWarnings.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
              <TriangleAlert className="size-3.5" />
              {outputWarnings.length} field{outputWarnings.length === 1 ? " doesn't" : "s don't"} match the output
              schema
            </span>
          )}
          <ValueDisplay value={state.output} />
        </div>
      )}
    </div>
  )
}
