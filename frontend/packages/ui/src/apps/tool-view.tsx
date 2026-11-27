import {HM_AGENT_TYPE, hostListsChild, parentDocumentId, TOOL_ENTRY_FILE} from '@seed-hypermedia/client/apps'
import type {HMDocument, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, useUniversalClient} from '@shm/shared'
import {useDocumentActions} from '@shm/shared/document-actions-context'
import {selectCanEdit, selectIsEditing, useDocumentMachineRefOptional} from '@shm/shared/models/use-document-machine'
import {useEditorGate} from '@shm/shared/models/use-editor-gate'
import {useNavigate} from '@shm/shared/utils/navigation'
import {useResource} from '@shm/shared/models/entity'
import {useQuery} from '@tanstack/react-query'
import {ChevronDown, ChevronRight} from 'lucide-react'
import {useEffect, useRef, useState, type ReactNode} from 'react'
import {AgentSubpageHeader} from '../agents/header'
import {Button} from '../button'
import {CodeTextArea} from '../code-text-area'
import {Textarea} from '../components/textarea'
import {cn} from '../utils'
import {useFileUrl} from '../get-file-url'
import type {HypermediaSchema} from '../schema/engine'
import {SchemaView} from '../schema/explorer'
import {emptyStructSchema, SchemaEditor} from '../schema/schema-editor'
import {publishSchemaObject} from '../schema/schema-document'
import {useResolvedSchema} from '../schema/schema-resolve'
import {SizableText} from '../text'
import {toast} from '../toast'
import {useAppDialog} from '../universal-dialog'
import {HostSettings, useToolRunConfig} from './app-settings'
import {TOOL_DESCRIPTION_HINT} from './create-dialogs'
import {toolCodeFolder} from './publish'
import {useResourceDraft} from './resource-draft'
import {ToolRunSection} from './running'
import {UseToolInHostDialog} from './use-tool-dialogs'

const noSchemaNav = () => {}

/**
 * A tool: a header with a back button and the tool's name, then one page with its description,
 * its Run form, and its schemas and code. Edits stage into the document's draft like any
 * document's: it saves itself, the top bar's Publish button appears once there are changes, and
 * Discard Changes drops them. Someone who can edit the tool can run a draft before publishing it.
 *
 * A tool declares the config it needs. Inside an app or an agent (the host's tabs stay above it,
 * Tools selected) the host supplies the values and runs the tool for every caller. A tool in
 * neither is its author's to try: its page takes the values the author runs it with. Moving or
 * copying it into an app or an agent is how anyone else gets to use it.
 */
export function ToolDocumentView({
  docId,
  document,
  canEdit,
  documentation,
}: {
  docId: UnpackedHypermediaId
  document: HMDocument
  canEdit: boolean
  /**
   * The document's body, as the page around renders it: the editor for someone who can edit. It is
   * the tool's documentation. Without it (a page that cannot render a body) the part is left out.
   */
  documentation?: ReactNode
}) {
  const client = useUniversalClient()
  const navigate = useNavigate()
  const useInHost = useAppDialog(UseToolInHostDialog, {className: 'w-full max-w-lg'})
  const draft = useResourceDraft(document)
  // Running needs the right to write the tool, not an editable page: an earlier version opened from
  // the tool's history cannot be edited, and its code runs all the same.
  const {canWriteDocument} = useDocumentActions()
  const canRun = canEdit || !!canWriteDocument?.(docId)
  // A document's body opens for editing when its text is clicked. A tool with no documentation yet
  // has no text to click, so a click anywhere in the part starts the editing, with the cursor in it.
  const machine = useDocumentMachineRefOptional()
  const {isEditing} = useEditorGate()
  const startWriting = () => {
    if (!machine) return
    const snapshot = machine.getSnapshot()
    if (!selectCanEdit(snapshot) || selectIsEditing(snapshot)) return
    machine.send({type: 'edit.start', cursorPosition: 'end'})
  }
  const [showDefinition, setShowDefinition] = useState(false)
  const definitionOpen = showDefinition || draft.hasDraft
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
  const parentId = parentDocumentId(docId)
  const parentResource = useResource(parentId)
  const parentDocument = parentResource.data?.type === 'document' ? parentResource.data.document : null
  // The parent says whether the tool has a host: until it has loaded, the tool is not run from here.
  const hostKnown = !parentId || !parentResource.isInitialLoading
  const hosted = !!parentId && hostListsChild(parentId, parentDocument, docId)
  const standalone = hostKnown && !hosted
  const appId = hosted ? parentId : docId
  // A tool on its own is its own host: it runs with its own server and config, draft included.
  const appDocument = hosted ? parentDocument : {...document, metadata: saved}
  // Apps and agents both host tools; an agent's tools go back to the agent itself.
  const hostIsAgent = hosted && parentDocument?.metadata.type === HM_AGENT_TYPE
  // What the tool cannot run without, and has not been given: Run waits for it and says so.
  const runConfig = useToolRunConfig({
    host: {id: appId, document: appDocument ?? document},
    standalone,
    canEdit,
  })
  const missingConfig = hostKnown ? [...runConfig.missing.public, ...runConfig.missing.private] : []
  const configPart = useRef<HTMLDivElement>(null)
  const openHostSettings = () => navigate({key: 'document', id: appId, appView: 'settings'})
  // A tool on its own takes its private config in a dialog and its public config in the Config part
  // below; inside an app or an agent, the host's settings hold both.
  const setConfig = !standalone
    ? openHostSettings
    : !canEdit
      ? undefined
      : runConfig.missing.private.length && runConfig.setPrivate
        ? runConfig.setPrivate
        : () => configPart.current?.scrollIntoView({behavior: 'smooth', block: 'start'})

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
        subtitle={draft.hasDraft ? 'Unpublished changes: publish or discard them in the top bar.' : undefined}
        onTitleChange={canEdit ? (next) => draft.change({name: next}) : undefined}
        backLabel={!hosted ? 'Back' : hostIsAgent ? 'Back to agent' : 'Back to app tools'}
        onBack={() =>
          navigate(
            !hosted
              ? {key: 'document', id: parentId ?? hmId(docId.uid)}
              : hostIsAgent
                ? {key: 'document', id: appId}
                : {key: 'document', id: appId, appView: 'tools'},
          )
        }
      />
      {runConfig.dialog}
      {/* relative: whatever is positioned inside (the editor's menus, hidden form inputs) is laid out
          against this column and scrolls with it, instead of stretching the page behind it. */}
      <section className="relative mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-6 overflow-y-auto p-4">
        <Section title="Description">
          {canEdit ? (
            <>
              <SizableText size="sm" color="muted" className="shrink-0" data-testid="tool-description-hint">
                {TOOL_DESCRIPTION_HINT}
              </SizableText>
              <Textarea
                aria-label="Tool description"
                value={summary}
                placeholder="What the tool does, with what, and when to use it"
                onChange={(event) => draft.change({summary: event.target.value || null})}
              />
            </>
          ) : (
            <SizableText color="muted">{summary || 'No description.'}</SizableText>
          )}
        </Section>
        {documentation ? (
          <Section title="Documentation">
            <SizableText size="sm" color="muted" className="shrink-0">
              How to use this tool: what to prepare before a call, and what to do with the result. It is written like
              any document, with links, embeds and media. An agent reads it when it decides to use the tool, before its
              first call.
            </SizableText>
            {/* The document's own body and editor. shrink-0: it sits in this page's scrolling column.
                On a document's own page the editor ends in 500px of empty space to click in. Here the
                next part follows, and a click anywhere in the box already starts the writing, so that
                space is cut down to a line. */}
            <div
              className={cn(
                'shrink-0 rounded-lg border py-2 [&_[data-editor-end-area]]:h-6',
                canEdit && !isEditing && 'cursor-text',
              )}
              data-testid="tool-documentation"
              onClick={canEdit ? startWriting : undefined}
            >
              {canEdit && !isEditing && !draft.content.length ? (
                <SizableText size="sm" color="muted" className="px-4 pt-2">
                  No documentation yet. Click here to write it.
                </SizableText>
              ) : null}
              {documentation}
            </div>
          </Section>
        ) : null}
        {hostKnown ? (
          <ToolRunSection
            appId={appId}
            app={appDocument}
            toolId={docId}
            inputSchemaRef={inputSchemaRef}
            outputSchemaRef={outputSchemaRef}
            standalone={standalone}
            draft={canRun ? {source: code ?? (saved.code ? source.data : '')} : undefined}
            onOpenSettings={standalone ? undefined : openHostSettings}
            missingConfig={missingConfig}
            onSetConfig={setConfig}
          />
        ) : null}
        {hostKnown ? (
          <div ref={configPart} className="flex shrink-0 flex-col gap-4" data-testid="tool-config">
            <HostSettings host={{id: docId, document}} canEdit={canEdit} kind="tool" standalone={standalone} />
          </div>
        ) : null}
        {standalone ? (
          <div
            className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
            data-testid="tool-use-in-host"
          >
            <SizableText size="sm" color="muted" className="min-w-0 flex-1">
              This tool is in no app or agent. One that uses it supplies the config it declares and runs it for its
              callers. The tool stays here.
            </SizableText>
            <Button size="sm" variant="outline" onClick={() => useInHost.open({tool: {id: docId, document}})}>
              Use in an app or agent
            </Button>
            {useInHost.content}
          </div>
        ) : null}
        {/* Using the tool ends here; below is what defines it, edited in a draft and published. It
            starts folded, so the page reads as a tool to run, and opens itself while a draft is pending. */}
        <button
          type="button"
          className="border-border flex items-start gap-2 border-t pt-6 text-left"
          onClick={() => setShowDefinition((open) => !open)}
          aria-expanded={definitionOpen}
        >
          {definitionOpen ? (
            <ChevronDown className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          ) : (
            <ChevronRight className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          )}
          <span className="flex flex-col gap-1">
            <SizableText weight="bold">Definition</SizableText>
            <SizableText size="sm" color="muted">
              {canEdit
                ? 'What the tool takes, what it returns, and its code. Changes stay in a draft until you publish them from the top bar.'
                : 'What the tool takes, what it returns, and its code.'}
            </SizableText>
          </span>
        </button>
        {definitionOpen ? (
          <>
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
                <code>ctx</code> holds the <code>publicConfig</code> and <code>privateConfig</code> of{' '}
                {standalone ? 'this tool' : 'its app'}.
              </SizableText>
            </Section>
          </>
        ) : null}
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
