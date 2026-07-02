import {usePluginCode} from '@/models/plugins'
import {useSchemaRegistry} from '@/models/blob-schema'
import {useUniversalClient} from '@shm/shared'
import {instantiateSchema, validateValue, type SchemaWarning} from '@shm/ui/blob-schema'
import {BlobSchemaProvider} from '@shm/ui/blob-schema-context'
import {Button} from '@shm/ui/button'
import type {PluginManifest} from '@shm/ui/plugin-manifest'
import {Spinner} from '@shm/ui/spinner'
import {CBOR_VALUE_RULES, isPlainObject, ValueDisplay, ValueEditor, ValueEditorProvider} from '@shm/ui/value-editor'
import {Play, TriangleAlert} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'
import {createDesktopPluginBridge} from './desktop-plugin-bridge'
import {PluginHost} from './plugin-host'

/**
 * The user-facing invoke surface for one plugin action: the input form is
 * auto-generated from the action's input schema blob (the full schema-driven
 * editor), execution runs in the sandbox through the standard desktop bridge
 * (document capabilities work when an editable document page is open), and
 * output is advisorily validated against the output schema and rendered as
 * structured data.
 */
export function RunActionPanel({
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
  useEffect(() => {
    return () => hostRef.current?.destroy()
  }, [])

  // Seed the form once the input schema arrives.
  const inputSchema = inputSchemas.rootSchema
  const effectiveInput =
    input !== undefined ? input : inputSchema ? instantiateSchema(inputSchema, inputSchemas.registry) ?? {} : {}

  const outputWarnings: SchemaWarning[] =
    state.phase === 'done' && outputSchemas.rootSchema
      ? validateValue(state.output, outputSchemas.rootSchema, outputSchemas.registry)
      : []

  const run = async () => {
    if (!code.data) return
    setState({phase: 'running'})
    try {
      if (!hostRef.current) {
        hostRef.current = new PluginHost(manifest, code.data, createDesktopPluginBridge(universalClient))
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
