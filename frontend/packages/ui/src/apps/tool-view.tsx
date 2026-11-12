import {parentDocumentId, TOOL_ENTRY_FILE} from '@seed-hypermedia/client/apps'
import type {HMDocument, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useUniversalClient} from '@shm/shared'
import {useNavigate} from '@shm/shared/utils/navigation'
import {useQuery} from '@tanstack/react-query'
import {Save} from 'lucide-react'
import {useEffect, useState, type ReactNode} from 'react'
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
import {setAttribute, toolCodeFolder, useAppsPublisher} from './publish'

const noSchemaNav = () => {}

/**
 * A tool, shown inside its app (the app's tabs stay above it, Tools selected) like an agent
 * session: a header with a back button and the tool's name, then one page with its description,
 * schemas and code. Every edit is published together with Save.
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
  const publisher = useAppsPublisher()
  const navigate = useNavigate()
  const saved = document.metadata
  const source = useToolSource(saved.code)
  const [name, setName] = useState(saved.name ?? '')
  const [summary, setSummary] = useState(saved.summary ?? '')
  // A schema edit, or null to remove it; undefined while the saved schema is untouched.
  const [input, setInput] = useState<HypermediaSchema | null | undefined>(undefined)
  const [output, setOutput] = useState<HypermediaSchema | null | undefined>(undefined)
  const [code, setCode] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setName(saved.name ?? '')
    setSummary(saved.summary ?? '')
    setInput(undefined)
    setOutput(undefined)
    setCode(null)
  }, [saved.name, saved.summary, saved.inputSchema, saved.outputSchema, saved.code])
  const codeDirty = code !== null && code !== (source.data ?? '')
  const dirty =
    name !== (saved.name ?? '') ||
    summary !== (saved.summary ?? '') ||
    input !== undefined ||
    output !== undefined ||
    codeDirty
  const appId = parentDocumentId(docId)

  async function schemaRefFor(schema: HypermediaSchema | null) {
    return schema ? `ipfs://${await publishSchemaObject(client, schema as Record<string, unknown>)}` : null
  }
  async function save() {
    setSaving(true)
    try {
      const ops = []
      if (name !== (saved.name ?? '')) ops.push(setAttribute('name', name.trim()))
      if (summary !== (saved.summary ?? '')) ops.push(setAttribute('summary', summary.trim() || null))
      if (input !== undefined) ops.push(setAttribute('inputSchema', await schemaRefFor(input)))
      if (output !== undefined) ops.push(setAttribute('outputSchema', await schemaRefFor(output)))
      const folder = codeDirty && code !== null ? await toolCodeFolder(code) : null
      if (folder) ops.push(setAttribute('code', folder.code))
      await publisher.update(docId, ops, folder?.blobs ?? [])
      toast.success('Tool saved')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AgentSubpageHeader
        title={canEdit ? name : saved.name || docId.path?.at(-1) || ''}
        placeholder="Tool name"
        onTitleChange={canEdit ? setName : undefined}
        backLabel="Back to app tools"
        onBack={() => appId && navigate({key: 'document', id: appId, appView: 'tools'})}
        actions={
          canEdit && dirty ? (
            <Button size="sm" variant="default" disabled={saving || !name.trim()} onClick={() => void save()}>
              <Save className="size-3.5" /> {saving ? 'Saving…' : 'Save'}
            </Button>
          ) : null
        }
      />
      <section className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-6 overflow-y-auto p-4">
        <Section title="Description">
          {canEdit ? (
            <Textarea
              aria-label="Tool description"
              value={summary}
              placeholder="What the tool does"
              onChange={(event) => setSummary(event.target.value)}
            />
          ) : (
            <SizableText color="muted">{saved.summary || 'No description.'}</SizableText>
          )}
        </Section>
        <Section title="Input">
          <SchemaField
            label="Input"
            schemaRef={input === null ? undefined : saved.inputSchema}
            value={input ?? null}
            onChange={setInput}
            canEdit={canEdit}
          />
        </Section>
        <Section title="Output">
          <SchemaField
            label="Output"
            schemaRef={output === null ? undefined : saved.outputSchema}
            value={output ?? null}
            onChange={setOutput}
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
              aria-label={`${saved.name || 'Tool'} ${TOOL_ENTRY_FILE}`}
              className="min-h-80"
              value={code ?? (source.isLoading ? '' : source.data ?? '')}
              placeholder={source.isLoading ? 'Loading…' : undefined}
              readOnly={!canEdit}
              onChange={(event) => setCode(event.currentTarget.value)}
            />
          )}
          <SizableText size="xs" color="muted">
            The tool's code: <code>export default async function (input): Promise&lt;output&gt;</code>. Nothing runs
            tools yet.
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
