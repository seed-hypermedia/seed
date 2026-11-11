import {HM_APP_TYPE, parentDocumentId, TOOL_ENTRY_FILE} from '@seed-hypermedia/client/apps'
import type {HMDocument, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useUniversalClient} from '@shm/shared'
import {useResource} from '@shm/shared/models/entity'
import type {DocumentRoute} from '@shm/shared/routes'
import {useNavigate} from '@shm/shared/utils/navigation'
import {useQuery} from '@tanstack/react-query'
import {Save} from 'lucide-react'
import {useEffect, useMemo, useState, type ReactNode} from 'react'
import {Button} from '../button'
import {CodeTextArea} from '../code-text-area'
import {Input} from '../components/input'
import {Label} from '../components/label'
import {Textarea} from '../components/textarea'
import {useFileUrl} from '../get-file-url'
import type {HypermediaSchema} from '../schema/engine'
import {SchemaView} from '../schema/explorer'
import {emptyStructSchema, SchemaEditor} from '../schema/schema-editor'
import {publishSchemaObject} from '../schema/schema-document'
import {useResolvedSchema} from '../schema/schema-resolve'
import {SizableText} from '../text'
import {toast} from '../toast'
import {setAttribute, toolCodeFolder, useAppsPublisher, type AppRef} from './publish'

const noSchemaNav = () => {}

/** A tool document's tabs: the tool itself (schemas and code) and its Settings. */
export function ToolDocumentView({
  docId,
  document,
  appView,
  canEdit,
}: {
  docId: UnpackedHypermediaId
  document: HMDocument
  appView: DocumentRoute['appView']
  canEdit: boolean
}) {
  if (appView === 'settings') return <ToolSettingsTab docId={docId} document={document} canEdit={canEdit} />
  return <ToolTab docId={docId} document={document} canEdit={canEdit} />
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

function ToolTab({docId, document, canEdit}: {docId: UnpackedHypermediaId; document: HMDocument; canEdit: boolean}) {
  const metadata = document.metadata
  const source = useToolSource(metadata.code)
  const publisher = useAppsPublisher()
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const current = draft ?? source.data ?? ''
  const dirty = draft !== null && draft !== (source.data ?? '')
  useEffect(() => setDraft(null), [metadata.code])
  async function saveCode() {
    setSaving(true)
    try {
      const folder = await toolCodeFolder(current)
      await publisher.update(docId, [setAttribute('code', folder.code)], folder.blobs)
      toast.success('Code saved')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }
  return (
    <section className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-6 overflow-y-auto p-4">
      <div className="flex flex-col gap-1 pt-4">
        <SizableText size="2xl" weight="bold" className="font-mono">
          {metadata.name || docId.path?.at(-1)}
        </SizableText>
        {metadata.summary ? <SizableText color="muted">{metadata.summary}</SizableText> : null}
      </div>
      <Section title="Input">
        <SchemaRef schemaRef={metadata.inputSchema} empty="No input schema yet. Set one in Settings." />
      </Section>
      <Section title="Output">
        <SchemaRef schemaRef={metadata.outputSchema} empty="No output schema." />
      </Section>
      <Section
        title={TOOL_ENTRY_FILE}
        action={
          canEdit && dirty ? (
            <Button size="sm" variant="default" disabled={saving} onClick={() => void saveCode()}>
              <Save className="size-3.5" /> {saving ? 'Saving…' : 'Save'}
            </Button>
          ) : null
        }
      >
        {source.isError && draft === null ? (
          <SizableText size="sm" className="text-destructive" role="alert">
            {source.error instanceof Error ? source.error.message : 'Could not load the code'}
          </SizableText>
        ) : (
          <CodeTextArea
            aria-label={`${metadata.name || 'Tool'} ${TOOL_ENTRY_FILE}`}
            className="min-h-80"
            value={source.isLoading && draft === null ? '' : current}
            placeholder={source.isLoading ? 'Loading…' : undefined}
            readOnly={!canEdit}
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
        )}
        <SizableText size="xs" color="muted">
          The tool's code: <code>export default async function (input): Promise&lt;output&gt;</code>. Nothing runs tools
          yet.
        </SizableText>
      </Section>
    </section>
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

function ToolSettingsTab({
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
  const parentId = useMemo(() => parentDocumentId(docId), [docId])
  const parent = useResource(parentId)
  const app: AppRef | undefined =
    parentId && parent.data?.type === 'document' && parent.data.document.metadata.type === HM_APP_TYPE
      ? {id: parentId, document: parent.data.document}
      : undefined
  const [name, setName] = useState(saved.name ?? '')
  const [summary, setSummary] = useState(saved.summary ?? '')
  // A schema edit, or null to remove it; undefined while the saved schema is untouched.
  const [input, setInput] = useState<HypermediaSchema | null | undefined>(undefined)
  const [output, setOutput] = useState<HypermediaSchema | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => {
    setName(saved.name ?? '')
    setSummary(saved.summary ?? '')
    setInput(undefined)
    setOutput(undefined)
  }, [saved.name, saved.summary, saved.inputSchema, saved.outputSchema])
  const dirty =
    name !== (saved.name ?? '') || summary !== (saved.summary ?? '') || input !== undefined || output !== undefined
  async function schemaRefFor(schema: HypermediaSchema | null) {
    return schema ? `ipfs://${await publishSchemaObject(client, schema as Record<string, unknown>)}` : null
  }
  async function save() {
    setBusy(true)
    try {
      const ops = []
      if (name !== (saved.name ?? '')) ops.push(setAttribute('name', name.trim()))
      if (summary !== (saved.summary ?? '')) ops.push(setAttribute('summary', summary.trim() || null))
      if (input !== undefined) ops.push(setAttribute('inputSchema', await schemaRefFor(input)))
      if (output !== undefined) ops.push(setAttribute('outputSchema', await schemaRefFor(output)))
      await publisher.update(docId, ops)
      toast.success('Tool saved')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-5 overflow-y-auto p-4">
      <div className="grid gap-1">
        <Label htmlFor="tool-settings-name">Name</Label>
        <Input id="tool-settings-name" value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="tool-settings-summary">Description</Label>
        <Textarea
          id="tool-settings-summary"
          value={summary}
          disabled={!canEdit}
          onChange={(e) => setSummary(e.target.value)}
        />
      </div>
      <Section title="Input schema">
        <SchemaField
          label="Input"
          schemaRef={input === null ? undefined : saved.inputSchema}
          value={input ?? null}
          onChange={setInput}
          canEdit={canEdit}
        />
      </Section>
      <Section title="Output schema">
        <SchemaField
          label="Output"
          schemaRef={output === null ? undefined : saved.outputSchema}
          value={output ?? null}
          onChange={setOutput}
          canEdit={canEdit}
          optional
        />
      </Section>
      {canEdit ? (
        <div className="flex items-center justify-between gap-2 pt-2">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <SizableText size="sm">Delete this tool?</SizableText>
              <Button
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setBusy(true)
                  publisher
                    .remove(docId, document, app)
                    .then(() => {
                      if (app) navigate({key: 'document', id: app.id, appView: 'tools'})
                    })
                    .catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
                    .finally(() => setBusy(false))
                }}
              >
                Delete
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmDelete(true)}>
              Delete tool
            </Button>
          )}
          <Button variant="default" disabled={!dirty || !name.trim() || busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      ) : null}
    </section>
  )
}
