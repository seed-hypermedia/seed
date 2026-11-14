import {HM_AGENT_TYPE, parentDocumentId, TOOL_ENTRY_FILE} from '@seed-hypermedia/client/apps'
import type {HMDocument, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useUniversalClient} from '@shm/shared'
import {useNavigate} from '@shm/shared/utils/navigation'
import {useResource} from '@shm/shared/models/entity'
import {useQuery} from '@tanstack/react-query'
import {useEffect, useRef, useState, type ReactNode} from 'react'
import {AgentSubpageHeader} from '../agents/header'
import {Button} from '../button'
import {CodeTextArea} from '../code-text-area'
import {Textarea} from '../components/textarea'
import {useFileUrl} from '../get-file-url'
import type {HypermediaSchema} from '../schema/engine'
import {SchemaView} from '../schema/explorer'
import {emptyStructSchema, SchemaEditor} from '../schema/schema-editor'
import {publishSchemaObject} from '../schema/schema-document'
import {useResolvedSchema} from '../schema/schema-resolve'
import {SizableText} from '../text'
import {toast} from '../toast'
import {toolCodeFolder} from './publish'
import {useResourceDraft} from './resource-draft'
import {ToolRunSection} from './running'

const noSchemaNav = () => {}

/**
 * A tool, shown inside its app or agent (the host's tabs stay above it, Tools selected) like an
 * agent session: a header with a back button and the tool's name, then one page with its
 * description, schemas and code. Edits stage into the document's draft like any document's: it
 * saves itself, the top bar's Publish button appears once there are changes, and Discard Changes
 * drops them.
 */
export function ToolDocumentView({
  docId,
  document,
  canEdit,
}: {
  docId: UnpackedHypermediaId
  document: HMDocument
  canEdit: boolean
}) {
  const client = useUniversalClient()
  const navigate = useNavigate()
  const draft = useResourceDraft(document)
  const saved = draft.metadata
  const source = useToolSource(typeof saved.code === 'string' ? saved.code : undefined)
  // Schema and code edits show at once; the draft takes them (as published blobs) after a pause.
  const [input, setInput] = useState<HypermediaSchema | null | undefined>(undefined)
  const [output, setOutput] = useState<HypermediaSchema | null | undefined>(undefined)
  const [code, setCode] = useState<string | null>(null)
  const written = useRef<{inputSchema?: unknown; outputSchema?: unknown; code?: unknown}>({})
  // A version or draft that these fields did not write (published elsewhere, or discarded) replaces them.
  useEffect(() => {
    if (saved.inputSchema !== written.current.inputSchema) setInput(undefined)
    if (saved.outputSchema !== written.current.outputSchema) setOutput(undefined)
    if (saved.code !== written.current.code) setCode(null)
    written.current = {inputSchema: saved.inputSchema, outputSchema: saved.outputSchema, code: saved.code}
  }, [saved.inputSchema, saved.outputSchema, saved.code])
  const appId = parentDocumentId(docId)
  const appResource = useResource(appId)
  const appDocument = appResource.data?.type === 'document' ? appResource.data.document : null
  // Apps and agents both host tools; an agent's tools go back to the agent itself.
  const hostIsAgent = appDocument?.metadata.type === HM_AGENT_TYPE

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  function later(key: string, run: () => Promise<void>) {
    clearTimeout(timers.current[key])
    timers.current[key] = setTimeout(() => {
      run().catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
    }, 400)
  }
  function changeSchema(key: 'inputSchema' | 'outputSchema', schema: HypermediaSchema | null) {
    ;(key === 'inputSchema' ? setInput : setOutput)(schema)
    later(key, async () => {
      const ref = schema ? `ipfs://${await publishSchemaObject(client, schema as Record<string, unknown>)}` : null
      written.current[key] = ref ?? undefined
      draft.change({[key]: ref})
    })
  }
  function changeCode(text: string) {
    setCode(text)
    later('code', async () => {
      const folder = await toolCodeFolder(text)
      await draft.storeBlobs(folder.blobs)
      written.current.code = folder.code
      draft.change({code: folder.code})
    })
  }
  const name = typeof saved.name === 'string' ? saved.name : ''
  const summary = typeof saved.summary === 'string' ? saved.summary : ''
  const inputSchemaRef = typeof saved.inputSchema === 'string' ? saved.inputSchema : undefined
  const outputSchemaRef = typeof saved.outputSchema === 'string' ? saved.outputSchema : undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AgentSubpageHeader
        title={name || (canEdit ? '' : docId.path?.at(-1) || '')}
        placeholder="Tool name"
        onTitleChange={canEdit ? (next) => draft.change({name: next}) : undefined}
        backLabel={hostIsAgent ? 'Back to agent' : 'Back to app tools'}
        onBack={() =>
          appId && navigate(hostIsAgent ? {key: 'document', id: appId} : {key: 'document', id: appId, appView: 'tools'})
        }
      />
      <section className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-6 overflow-y-auto p-4">
        <Section title="Description">
          {canEdit ? (
            <Textarea
              aria-label="Tool description"
              value={summary}
              placeholder="What the tool does"
              onChange={(event) => draft.change({summary: event.target.value || null})}
            />
          ) : (
            <SizableText color="muted">{summary || 'No description.'}</SizableText>
          )}
        </Section>
        {appId ? (
          <ToolRunSection
            appId={appId}
            app={appDocument}
            toolId={docId}
            inputSchemaRef={inputSchemaRef}
            onOpenSettings={() => navigate({key: 'document', id: appId, appView: 'settings'})}
          />
        ) : null}
        <Section title="Input">
          <SchemaField
            label="Input"
            schemaRef={input === null ? undefined : inputSchemaRef}
            value={input ?? null}
            onChange={(schema) => changeSchema('inputSchema', schema)}
            canEdit={canEdit}
          />
        </Section>
        <Section title="Output">
          <SchemaField
            label="Output"
            schemaRef={output === null ? undefined : outputSchemaRef}
            value={output ?? null}
            onChange={(schema) => changeSchema('outputSchema', schema)}
            canEdit={canEdit}
            optional
          />
        </Section>
        <Section title={TOOL_ENTRY_FILE}>
          {source.isError && code === null ? (
            <SizableText size="sm" className="text-destructive" role="alert">
              {source.error instanceof Error ? source.error.message : 'Could not load the code'}
            </SizableText>
          ) : (
            <CodeTextArea
              aria-label={`${name || 'Tool'} ${TOOL_ENTRY_FILE}`}
              className="min-h-80"
              value={code ?? (source.isLoading ? '' : source.data ?? '')}
              placeholder={source.isLoading ? 'Loading…' : undefined}
              readOnly={!canEdit}
              onChange={(event) => changeCode(event.currentTarget.value)}
            />
          )}
          <SizableText size="xs" color="muted">
            The tool's code: <code>export default async function (input, ctx): Promise&lt;output&gt;</code>, where{' '}
            <code>ctx</code> holds the app's <code>publicConfig</code> and <code>privateConfig</code>.
          </SizableText>
        </Section>
      </section>
    </div>
  )
}

function Section({title, children, action}: {title: string; children: ReactNode; action?: ReactNode}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <SizableText size="sm" weight="bold">
          {title}
        </SizableText>
        {action}
      </div>
      {children}
    </div>
  )
}

/** The tool's `index.ts`, read from its code folder. */
function useToolSource(code: string | undefined) {
  const fileUrl = useFileUrl()
  return useQuery({
    queryKey: ['tool-source', code],
    enabled: !!code,
    queryFn: async () => {
      const response = await fetch(`${fileUrl(code!)}/${TOOL_ENTRY_FILE}`)
      if (!response.ok) throw new Error(`Could not load ${TOOL_ENTRY_FILE} (${response.status})`)
      return response.text()
    },
    staleTime: Infinity,
  })
}

function SchemaRef({schemaRef, empty}: {schemaRef: string | undefined; empty: string}) {
  const resolved = useResolvedSchema(schemaRef)
  if (!schemaRef)
    return (
      <SizableText size="sm" color="muted">
        {empty}
      </SizableText>
    )
  if (!resolved.schema)
    return (
      <SizableText size="sm" color="muted">
        {resolved.isLoading ? 'Loading schema…' : `Could not resolve ${schemaRef}`}
      </SizableText>
    )
  return (
    <div className="border-border rounded-lg border p-3">
      <SchemaView schema={resolved.schema} nav={noSchemaNav} hideIdentity />
    </div>
  )
}

function SchemaField({
  label,
  schemaRef,
  value,
  onChange,
  canEdit,
  optional,
}: {
  label: string
  schemaRef: string | undefined
  value: HypermediaSchema | null
  onChange: (schema: HypermediaSchema | null) => void
  canEdit: boolean
  optional?: boolean
}) {
  const resolved = useResolvedSchema(schemaRef)
  const shown = value ?? resolved.schema ?? null
  if (!canEdit) return <SchemaRef schemaRef={schemaRef} empty={`No ${label.toLowerCase()} schema.`} />
  if (!shown)
    return (
      <div className="flex items-center gap-2">
        <SizableText size="sm" color="muted">
          {schemaRef && resolved.isLoading ? 'Loading schema…' : `No ${label.toLowerCase()} schema.`}
        </SizableText>
        {!(schemaRef && resolved.isLoading) ? (
          <Button size="sm" variant="outline" onClick={() => onChange(emptyStructSchema())}>
            Define {label.toLowerCase()}
          </Button>
        ) : null}
      </div>
    )
  return (
    <div className="flex flex-col gap-2">
      <SchemaEditor schema={shown} onSchema={onChange} />
      {optional ? (
        <div>
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            Remove {label.toLowerCase()} schema
          </Button>
        </div>
      ) : null}
    </div>
  )
}
