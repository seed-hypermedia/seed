import {
  HM_TOOL_TYPE,
  hostToolReferences,
  isAppChildId,
  isToolHostType,
  setToolReferenceOps,
} from '@seed-hypermedia/client/apps'
import {unpackHmId, type HMDocument, type HMMetadata, type UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, useUniversalClient} from '@shm/shared'
import {useDocumentActions} from '@shm/shared/document-actions-context'
import {useDirectory, useResource, useResources} from '@shm/shared/models/entity'
import {useSearch} from '@shm/shared/models/search'
import {abbreviateUid} from '@shm/shared/utils/abbreviate'
import {useNavigate} from '@shm/shared/utils/navigation'
import {useQuery} from '@tanstack/react-query'
import {Check} from 'lucide-react'
import {useState} from 'react'
import {Button} from '../button'
import {DialogDescription, DialogTitle} from '../components/dialog'
import {Input} from '../components/input'
import {RadioGroup, RadioGroupItem} from '../components/radio-group'
import {cn} from '../utils'
import {SizableText} from '../text'
import {toast} from '../toast'
import {toolConfigFields} from './app-settings'
import {useAppsPublisher, type AppRef} from './publish'

/**
 * How a host takes a tool that lives elsewhere. A link leaves the tool where it is and makes the
 * host point at it: `latest` runs whatever is published there, `pinned` keeps running the version
 * on screen. A copy is a separate tool under the host, which never follows the original.
 */
export type UseToolMode = 'latest' | 'pinned' | 'copy'

/** A document offered in a picker: a tool to take, or an app or agent to take it. */
type Candidate = {id: UnpackedHypermediaId; metadata: HMMetadata; version?: string}

/** The most documents a picker lists, and the most search results it reads to learn what they are. */
const LISTED = 30
const SEARCHED = 12

const typeOf = (metadata: HMMetadata | undefined) => (metadata as {type?: unknown} | undefined)?.type
const hostNoun = (host: Pick<AppRef, 'document'>) =>
  typeOf(host.document.metadata) === 'hm://hyper.media/agent' ? 'agent' : 'app'
const nameOf = (candidate: Candidate) => candidate.metadata.name?.trim() || candidate.id.path?.at(-1) || 'Untitled'

/** The name of a space, for saying where a document comes from. */
export function SpaceName({uid}: {uid: string}) {
  const home = useResource(hmId(uid))
  const name = home.data?.type === 'document' ? home.data.document.metadata.name : undefined
  return <>{name || abbreviateUid(uid)}</>
}

/**
 * The documents of the wanted kind a person can pick from. Before anything is typed they are the
 * ones in `spaces`. Typing narrows those by name and description and adds what search finds
 * anywhere. A pasted hm:// link names one document outright. Search says nothing of a document's
 * type, so its first results are read to keep the ones `accepts` takes.
 */
function useCandidates({
  spaces,
  query,
  accepts,
  excludes,
}: {
  spaces: string[]
  query: string
  accepts: (type: unknown) => boolean
  excludes: (id: UnpackedHypermediaId) => boolean
}): {items: Candidate[]; isLoading: boolean; refused: string | null} {
  const text = query.trim()
  const pasted = unpackHmId(text)
  const linked = pasted?.path?.length ? pasted : null
  const [first, second] = Array.from(new Set(spaces.filter(Boolean)))
  const firstDirectory = useDirectory(first ? hmId(first) : null, {mode: 'AllDescendants'})
  const secondDirectory = useDirectory(second ? hmId(second) : null, {mode: 'AllDescendants'})
  const linkedResource = useResource(linked)
  const searching = !linked && text.length >= 2
  const search = useSearch(text, {enabled: searching})

  const wanted = text.toLowerCase()
  const nearby: Candidate[] = [...(firstDirectory.data ?? []), ...(secondDirectory.data ?? [])]
    .filter((doc) => accepts(typeOf(doc.metadata)) && !excludes(doc.id))
    .filter(
      (doc) =>
        linked ||
        !wanted ||
        [doc.metadata.name, doc.metadata.summary, doc.id.path?.join('/')].some(
          (value) => typeof value === 'string' && value.toLowerCase().includes(wanted),
        ),
    )
    .map((doc) => ({id: hmId(doc.id.uid, {path: doc.id.path}), metadata: doc.metadata, version: doc.version}))
  const known = new Set(nearby.map((candidate) => candidate.id.id))
  const found = searching
    ? (search.data?.entities ?? [])
        .filter((entity) => entity.type === 'document' && !!entity.id.path?.length)
        .map((entity) => hmId(entity.id.uid, {path: entity.id.path}))
        .filter((id, index, all) => !known.has(id.id) && all.findIndex((other) => other.id === id.id) === index)
        .slice(0, SEARCHED)
    : []
  const foundResources = useResources(found)
  const elsewhere: Candidate[] = found.flatMap((id, index) => {
    const resource = foundResources[index]?.data
    if (resource?.type !== 'document' || !accepts(typeOf(resource.document.metadata)) || excludes(id)) return []
    return [{id, metadata: resource.document.metadata, version: resource.document.version}]
  })

  if (linked) {
    const resource = linkedResource.data
    const id = hmId(linked.uid, {path: linked.path})
    if (resource?.type !== 'document')
      return {items: [], isLoading: linkedResource.isLoading, refused: linkedResource.isLoading ? null : 'not-found'}
    if (!accepts(typeOf(resource.document.metadata))) return {items: [], isLoading: false, refused: 'wrong-kind'}
    if (excludes(id)) return {items: [], isLoading: false, refused: 'excluded'}
    return {
      items: [{id, metadata: resource.document.metadata, version: linked.version ?? resource.document.version}],
      isLoading: false,
      refused: null,
    }
  }
  return {
    items: [...nearby, ...elsewhere].slice(0, LISTED),
    isLoading:
      firstDirectory.isLoading ||
      (!!second && secondDirectory.isLoading) ||
      (searching && (search.isLoading || foundResources.some((resource) => resource.isInitialLoading))),
    refused: null,
  }
}

/** A search field and the documents it finds, one of which is picked. */
function CandidatePicker({
  label,
  placeholder,
  query,
  onQuery,
  candidates,
  selected,
  onSelect,
  empty,
  refusals,
  describe,
}: {
  label: string
  placeholder: string
  query: string
  onQuery: (query: string) => void
  candidates: ReturnType<typeof useCandidates>
  selected: Candidate | null
  onSelect: (candidate: Candidate) => void
  /** What to say when nothing is listed and nothing was refused. */
  empty: string
  /** What to say when a pasted link cannot be taken, by why. */
  refusals: Record<string, string>
  /** The line under a candidate's name. */
  describe: (candidate: Candidate) => React.ReactNode
}) {
  return (
    <div className="grid gap-2">
      <Input
        autoFocus
        aria-label={label}
        value={query}
        placeholder={placeholder}
        onChange={(event) => onQuery(event.target.value)}
      />
      <div role="listbox" aria-label={label} className="flex max-h-64 flex-col gap-1 overflow-y-auto">
        {candidates.items.map((candidate) => {
          const isSelected = selected?.id.id === candidate.id.id
          return (
            <button
              key={candidate.id.id}
              type="button"
              role="option"
              aria-selected={isSelected}
              onClick={() => onSelect(candidate)}
              className={cn(
                'hover:bg-muted focus-visible:ring-ring flex items-center gap-2 rounded-md p-2 text-left outline-none focus-visible:ring-2',
                isSelected && 'bg-muted',
              )}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <SizableText size="sm" weight="bold">
                  {nameOf(candidate)}
                </SizableText>
                <SizableText size="xs" color="muted">
                  {describe(candidate)}
                </SizableText>
                <SizableText size="xs" color="muted">
                  From <SpaceName uid={candidate.id.uid} />
                </SizableText>
              </span>
              {/* The check says which one is picked. The row is a list entry, not a second button. */}
              {isSelected ? <Check aria-hidden className="text-primary size-4 shrink-0" /> : null}
            </button>
          )
        })}
        {!candidates.items.length ? (
          <SizableText size="sm" color="muted" className="p-2" role="status">
            {candidates.isLoading
              ? 'Looking…'
              : candidates.refused
                ? refusals[candidates.refused] ?? refusals['not-found']
                : empty}
          </SizableText>
        ) : null}
      </div>
    </div>
  )
}

/** The choice between the two ways to link a tool and copying it, with what each one means here. */
function ModeChoice({
  mode,
  onMode,
  host,
  theirs,
}: {
  mode: UseToolMode
  onMode: (mode: UseToolMode) => void
  host: string
  /** Whether the tool is someone else's: following its latest version then trusts its author. */
  theirs: boolean
}) {
  const choices: {mode: UseToolMode; label: string; hint: string}[] = [
    {
      mode: 'latest',
      label: 'Link, always the latest version',
      hint: theirs
        ? `The tool stays where it is. This ${host} runs whatever its author publishes there, with the secrets the tool declares.`
        : `The tool stays where it is. This ${host} runs whatever you publish there.`,
    },
    {
      mode: 'pinned',
      label: 'Link, this version only',
      hint: `The tool stays where it is. This ${host} keeps running the version you see now, until you update it.`,
    },
    {
      mode: 'copy',
      label: 'Copy',
      hint: `A separate tool under this ${host}, yours to change. It never follows the original.`,
    },
  ]
  // Radio buttons, so the choice reads as one of three and cannot be taken for the list above it.
  return (
    <div className="grid gap-2 border-t pt-3">
      <SizableText size="sm" weight="bold" id="use-tool-mode-label">
        How this {host} uses it
      </SizableText>
      <RadioGroup
        aria-labelledby="use-tool-mode-label"
        value={mode}
        onValueChange={(value) => onMode(value as UseToolMode)}
        className="gap-2"
      >
        {choices.map((choice) => (
          <div key={choice.mode} className="flex items-start gap-2">
            <RadioGroupItem value={choice.mode} id={`use-tool-mode-${choice.mode}`} className="mt-0.5" />
            <label htmlFor={`use-tool-mode-${choice.mode}`} className="flex cursor-pointer flex-col gap-0.5">
              <SizableText size="sm">{choice.label}</SizableText>
              <SizableText size="xs" color="muted">
                {choice.hint}
              </SizableText>
            </label>
          </div>
        ))}
      </RadioGroup>
    </div>
  )
}

/** The settings and secrets a tool declares, which the host that takes it has to supply. */
function useToolNeeds(tool: Candidate | null) {
  const client = useUniversalClient()
  const id = tool ? (tool.version ? {...tool.id, version: tool.version, latest: false} : tool.id) : null
  const fields = useQuery({
    queryKey: ['tool-declared-config', id?.id, id?.version ?? null],
    enabled: !!id,
    useErrorBoundary: false,
    staleTime: 30_000,
    queryFn: () => toolConfigFields(client, [id!]),
  })
  return {
    secrets: (fields.data?.privateFields ?? []).map((field) => field.name),
    settings: (fields.data?.publicFields ?? []).map((field) => field.name),
  }
}

/** Says what a tool reads from its host, so nobody learns it from a failed call. */
function ToolNeeds({needs, host}: {needs: ReturnType<typeof useToolNeeds>; host: string}) {
  if (!needs.secrets.length && !needs.settings.length) return null
  const list = (names: string[]) => names.join(', ')
  return (
    <SizableText size="xs" color="muted" data-testid="tool-needs">
      This tool reads from the {host} that uses it
      {needs.secrets.length ? `: secrets ${list(needs.secrets)}` : ''}
      {needs.settings.length ? `${needs.secrets.length ? ';' : ':'} settings ${list(needs.settings)}` : ''}. Set them in
      the {host}’s Settings.
    </SizableText>
  )
}

/**
 * Makes `host` use `tool`. A link adds a card of the tool to the host: pinned to the version on
 * screen, or following the latest. A copy puts a separate tool under the host. Resolves to the tool
 * the host now has. `theirs` says whether a tool is someone else's, which decides what is offered
 * first: such a tool is pinned unless the person says otherwise, so its author cannot change what
 * the host runs.
 */
function useTakeTool() {
  const publisher = useAppsPublisher()
  const {canWriteDocument} = useDocumentActions()
  return {
    theirs: (tool: Candidate) => !canWriteDocument?.(tool.id),
    async take(host: AppRef, tool: Candidate, mode: UseToolMode): Promise<UnpackedHypermediaId> {
      if (mode === 'copy')
        return publisher.copyInto(host, tool.version ? {...tool.id, version: tool.version, latest: false} : tool.id)
      if (isAppChildId(host.id, tool.id)) throw new Error(`That tool is already under this ${hostNoun(host)}`)
      if (mode === 'pinned' && !tool.version) throw new Error('That tool has no published version to pin')
      const version = mode === 'pinned' ? tool.version! : null
      await publisher.update(host.id, setToolReferenceOps(host.id, host.document.content, tool.id, version))
      return tool.id
    },
  }
}

/** The form both dialogs end with: how to use the tool, what it needs, and the buttons. */
function TakeToolForm({
  host,
  tool,
  resolveHost,
  onClose,
}: {
  /** The noun of the host: app or agent. */
  host: string
  tool: Candidate | null
  /** The host to change, read when the person confirms. Null while none is chosen. */
  resolveHost: (() => Promise<AppRef>) | null
  onClose: () => void
}) {
  const navigate = useNavigate()
  const takeTool = useTakeTool()
  const needs = useToolNeeds(tool)
  // Until the person chooses, the first choice is the safe one for this tool.
  const [chosen, setChosen] = useState<UseToolMode | null>(null)
  const mode: UseToolMode = chosen ?? (tool && takeTool.theirs(tool) ? 'pinned' : 'latest')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = !!tool && !!resolveHost
  const submit = () => {
    if (!tool || !resolveHost || busy) return
    setBusy(true)
    setError(null)
    resolveHost()
      .then(async (target) => {
        const taken = await takeTool.take(target, tool, mode)
        const declares = needs.secrets.length + needs.settings.length > 0
        toast.success(
          mode === 'copy'
            ? `Copied ${nameOf(tool)}`
            : mode === 'pinned'
              ? `Linked ${nameOf(tool)}, pinned to this version`
              : `Linked ${nameOf(tool)}`,
        )
        onClose()
        // A tool that declares config is no use until the host supplies it: go where it is set.
        // A copy without any opens, since it is new and its owner's to change.
        if (declares) navigate({key: 'document', id: target.id, appView: 'settings'})
        else if (mode === 'copy') navigate({key: 'document', id: taken})
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false))
  }
  return (
    <>
      {tool ? <ModeChoice mode={mode} onMode={setChosen} host={host} theirs={takeTool.theirs(tool)} /> : null}
      {tool ? <ToolNeeds needs={needs} host={host} /> : null}
      {error ? (
        <SizableText size="sm" className="text-destructive" role="alert">
          {error}
        </SizableText>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" variant="default" disabled={!ready || busy} onClick={submit}>
          {busy ? 'Adding…' : mode === 'copy' ? 'Copy tool' : 'Link tool'}
        </Button>
      </div>
    </>
  )
}

/**
 * Adds a tool that lives elsewhere to an app or an agent, from the host's Tools tab. The person
 * finds the tool by name or pastes its link, then links it or copies it. Each tool is shown with
 * its description, the line an agent goes by when it decides whether to use the tool.
 */
export function AddExistingToolDialog({input, onClose}: {input: {host: AppRef}; onClose: () => void}) {
  const {host} = input
  const noun = hostNoun(host)
  const {selectedAccountUid} = useDocumentActions()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Candidate | null>(null)
  // The tools the host already links to: offering them again would only move their pin.
  const used = new Set(
    hostToolReferences(host.id, host.document.content).map(
      (reference) => hmId(reference.id.uid, {path: reference.id.path}).id,
    ),
  )
  const candidates = useCandidates({
    spaces: [host.id.uid, selectedAccountUid ?? ''],
    query,
    accepts: (type) => type === HM_TOOL_TYPE,
    excludes: (id) => isAppChildId(host.id, id) || used.has(id.id),
  })
  const tool = candidates.items.find((candidate) => candidate.id.id === selected?.id.id) ?? null
  return (
    <div className="grid gap-4" data-testid="add-existing-tool">
      <DialogTitle>Add an existing tool</DialogTitle>
      <DialogDescription>
        Use a tool that lives elsewhere in this {noun}. The {noun} supplies the settings and secrets the tool declares,
        and runs it for its callers.
      </DialogDescription>
      <CandidatePicker
        label="Find a tool"
        placeholder="Name of a tool, or its hm:// link"
        query={query}
        onQuery={setQuery}
        candidates={candidates}
        selected={tool}
        onSelect={setSelected}
        empty={query.trim() ? 'No tool found by that name.' : 'No tools here yet. Type a name, or paste a tool’s link.'}
        refusals={{
          'not-found': 'Nothing is published at that link.',
          'wrong-kind': 'That link is not a tool.',
          excluded: `This ${noun} already has that tool.`,
        }}
        describe={(candidate) => candidate.metadata.summary?.trim() || 'No description.'}
      />
      {/* Keyed by the tool: another tool starts from its own first choice. */}
      <TakeToolForm
        key={tool?.id.id ?? 'none'}
        host={noun}
        tool={tool}
        resolveHost={async () => host}
        onClose={onClose}
      />
    </div>
  )
}

/**
 * Puts a tool to use in an app or an agent, from the tool's own page. The person picks one of the
 * apps and agents they can write, then links the tool there or copies it there.
 */
export function UseToolInHostDialog({
  input,
  onClose,
}: {
  input: {tool: {id: UnpackedHypermediaId; document: HMDocument}}
  onClose: () => void
}) {
  const client = useUniversalClient()
  const {selectedAccountUid, canWriteDocument} = useDocumentActions()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Candidate | null>(null)
  const candidates = useCandidates({
    spaces: [selectedAccountUid ?? '', input.tool.id.uid],
    query,
    accepts: isToolHostType,
    excludes: (id) => !canWriteDocument?.(id),
  })
  const host = candidates.items.find((candidate) => candidate.id.id === selected?.id.id) ?? null
  const tool: Candidate = {
    id: hmId(input.tool.id.uid, {path: input.tool.id.path}),
    metadata: input.tool.document.metadata,
    version: input.tool.document.version,
  }
  const noun = host && typeOf(host.metadata) === 'hm://hyper.media/agent' ? 'agent' : 'app'
  return (
    <div className="grid gap-4" data-testid="use-tool-in-host">
      <DialogTitle>Use {nameOf(tool)} in an app or agent</DialogTitle>
      <DialogDescription>
        Pick an app or an agent you can write. It supplies the settings and secrets the tool declares, and runs the tool
        for its callers.
      </DialogDescription>
      <CandidatePicker
        label="Find an app or agent"
        placeholder="Name of an app or agent, or its hm:// link"
        query={query}
        onQuery={setQuery}
        candidates={candidates}
        selected={host}
        onSelect={setSelected}
        empty={
          query.trim()
            ? 'No app or agent you can write by that name.'
            : 'You have no apps or agents yet. Create one from New, then come back.'
        }
        refusals={{
          'not-found': 'Nothing is published at that link.',
          'wrong-kind': 'That link is not an app or an agent.',
          excluded: 'You cannot write that app or agent.',
        }}
        describe={(candidate) =>
          `${typeOf(candidate.metadata) === 'hm://hyper.media/agent' ? 'Agent' : 'App'}${
            candidate.metadata.summary?.trim() ? `. ${candidate.metadata.summary.trim()}` : ''
          }`
        }
      />
      <TakeToolForm
        host={noun}
        tool={host ? tool : null}
        resolveHost={
          host
            ? async () => {
                // The host as published now: its content is what the new card is added to.
                const resource = await client.request('Resource', host.id)
                if (resource?.type !== 'document') throw new Error('That app or agent could not be read')
                return {id: host.id, document: resource.document}
              }
            : null
        }
        onClose={onClose}
      />
    </div>
  )
}
