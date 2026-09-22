import {resolveHypermediaUrl} from '@seed-hypermedia/client'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {getMetadataName} from '@shm/shared/content'
import {useResource} from '@shm/shared/models/entity'
import {useSchemaDocumentSearch} from '@shm/shared/models/schema-documents'
import {useSearch} from '@shm/shared/models/search'
import {useSchemaSubtypes, useTypedDocumentSearch} from '@shm/shared/models/typed-documents'
import {useUniversalAppContext} from '@shm/shared/routing'
import {packHmId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {inClosure} from '@seed-hypermedia/client/schema-subtypes'
import {FileCode2, FileText, TriangleAlert, User, X} from 'lucide-react'
import {useState} from 'react'
import {Button} from './button'
import {Input} from './components/input'
import {HM_SCHEMAS, refToName} from './schema/engine'
import {HM_SCHEMA_PAGES} from './schema/schema-registry.generated'
import {useEffectiveSchemaRef} from './schema/schema-resolve'
import {Tooltip} from './tooltip'
import {cn} from './utils'

/**
 * Editor for schema fields holding hypermedia references as `hm://` URL
 * strings — `format: "hm-url"` (any document), `format: "hm-profile"`
 * (a bare account URL, no path), and the `schema` mode for a document's
 * attributes-schema bindings: a schema page's `hm://` URL (its
 * `schemaDefinition` is the schema) or an `ipfs://` schema object. A resolvable value displays as the
 * document/profile TITLE, not the raw URL; editing offers live search over
 * documents (or accounts only, for profiles) alongside direct URL pasting.
 * Advisory like everything schema-driven: any text can be committed — a
 * non-conforming value simply keeps the plain input and its warning badge.
 *
 * A document field may carry the schema's `target`: the type the referenced document should be
 * typed by (`{type: hm-url, target: <animal>}`). The search then offers documents whose effective
 * attributes schema is that type or any subtype of it, and a reference outside that set shows a
 * warning — advisory too, so a pasted URL of any type still commits.
 */
export type HMEntityFieldMode = 'document' | 'profile' | 'schema'

export function HMEntityField({
  value,
  mode,
  target,
  onValue,
  onOpen,
  onClear,
  autoFocus,
}: {
  value: string
  mode: HMEntityFieldMode
  /** Document mode: the schema (or a subtype) the referenced document should be typed by. */
  target?: string
  onValue: (value: unknown) => void
  /** Navigate to the referenced document/account when the pill is clicked. */
  onOpen?: (url: string) => void
  /** Offer an ✕ that removes the reference (the field becomes editable text again). */
  onClear?: () => void
  /** Focus the search input when it first mounts empty (a field the user just asked for). */
  autoFocus?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const unpacked = value ? unpackHmId(value) : null
  const conforms =
    (!!unpacked && (mode !== 'profile' || !unpacked.path?.length)) || (mode === 'schema' && /^ipfs:\/\//i.test(value))
  const typeCheck = useTargetConformance(mode === 'document' && conforms ? unpacked : null, target)

  if (conforms && !editing) {
    return (
      <div className="flex min-w-0 items-center gap-1">
        <HMEntityLink url={value} mode={mode} onOpen={onOpen} />
        {typeCheck.mismatch && (
          <Tooltip content={typeCheck.message}>
            <span data-testid="hm-target-mismatch" className="text-destructive flex shrink-0 items-center">
              <TriangleAlert className="size-3.5" />
            </span>
          </Tooltip>
        )}
        {/* One control: ✕ removes the reference; the field is then a plain input again
            (search or paste to pick another). */}
        {onClear ? (
          <Tooltip content="Remove reference">
            <Button
              variant="ghost"
              size="iconSm"
              aria-label="Remove reference"
              className="text-muted-foreground"
              onClick={onClear}
            >
              <X className="size-3.5" />
            </Button>
          </Tooltip>
        ) : (
          <Tooltip content={`Change (${unpacked?.id ?? value})`}>
            <Button
              variant="ghost"
              size="iconSm"
              aria-label="Remove reference"
              className="text-muted-foreground"
              onClick={() => setEditing(true)}
            >
              <X className="size-3.5" />
            </Button>
          </Tooltip>
        )}
      </div>
    )
  }
  return (
    <HMEntitySearchInput
      initialText={value}
      mode={mode}
      target={mode === 'document' ? target : undefined}
      onCommit={(next) => {
        onValue(next)
        setEditing(false)
      }}
      onCancel={conforms ? () => setEditing(false) : undefined}
      // Focus only when the user asked to change the reference — an empty field mounting on a
      // page (several of them, say) must not steal focus and blur-commit its neighbours.
      autoFocus={editing || !!autoFocus}
    />
  )
}

/**
 * A hypermedia reference rendered as a pill showing the target's TITLE (not the
 * raw URL), clickable to open it when `onOpen` is provided. Used both read-only
 * (ValueDisplay) and inside the editable HMEntityField.
 */
export function HMEntityLink({
  url,
  mode,
  onOpen,
}: {
  url: string
  mode?: HMEntityFieldMode
  onOpen?: (url: string) => void
}) {
  const id = url ? unpackHmId(url) : null
  const {title, library, isLoading} = useHmRefTitle(url)
  const isProfile = mode === 'profile' || (!!id && !id.path?.length)
  const Icon = library || mode === 'schema' ? FileCode2 : isProfile ? User : FileText
  const label = title ?? (id && isLoading ? 'Loading…' : id?.id ?? url)

  const pill = (
    <span className="bg-accent text-accent-foreground inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full py-0.5 pr-2 pl-2 text-sm">
      <Icon className="text-muted-foreground size-3.5 shrink-0" />
      <span className={cn('truncate', !title && 'text-muted-foreground font-mono text-xs')}>{label}</span>
    </span>
  )
  if (!id || !onOpen) return pill
  return (
    <Tooltip content={`Open ${id.id}`}>
      <button type="button" className="flex max-w-full min-w-0 hover:opacity-80" onClick={() => onOpen(url)}>
        {pill}
      </button>
    </Tooltip>
  )
}

/**
 * The readable name of an `hm://` reference: the document's title, or for a library type (a
 * `type` or `target` in a schema) its bundled page name, even when the site does not carry that
 * page (yet). Only a document has a title to fetch; anything else shows as it is.
 */
function useHmRefTitle(url: string): {title?: string; library: string | null; isLoading: boolean} {
  const slug = url.startsWith('hm://') ? refToName(url) : ''
  const library = slug && HM_SCHEMAS[slug] ? slug : null
  const id = url && !library ? unpackHmId(url) : null
  const resource = useResource(id)
  const document = resource.data && 'document' in resource.data ? resource.data.document : undefined
  const title = document
    ? getMetadataName(document.metadata)
    : library
      ? HM_SCHEMA_PAGES[library]?.name ?? library
      : undefined
  return {title, library, isLoading: !!id && resource.isLoading}
}

/**
 * Advisory check that the referenced document is typed by `target` or a subtype of it: its
 * effective attributes schema (own, or inherited from its folder) must lie in the target's
 * subtype closure. Silent while anything is still loading, and for a reference that is not a
 * document — a warning must never appear for lack of information.
 */
function useTargetConformance(
  id: UnpackedHypermediaId | null,
  target: string | undefined,
): {mismatch: boolean; message: string} {
  const active = !!target && !!id
  const resource = useResource(active ? id : null)
  const document = resource.data?.type === 'document' ? resource.data.document : undefined
  const effective = useEffectiveSchemaRef(active ? id : null, document?.metadata)
  const subtypes = useSchemaSubtypes(active ? target : null)
  const targetName = useHmRefTitle(target ?? '')
  if (!active || !document || !subtypes.data || resource.isLoading || effective.isLoading) {
    return {mismatch: false, message: ''}
  }
  if (inClosure(subtypes.data, effective.ref)) return {mismatch: false, message: ''}
  const expected = targetName.title ?? target
  return {
    mismatch: true,
    message: effective.ref
      ? `Not a ${expected}: this document's type is ${effective.ref}`
      : `Not a ${expected}: this document has no type`,
  }
}

type SearchResult = {id: UnpackedHypermediaId; title: string; offType?: boolean}

function HMEntitySearchInput({
  initialText,
  mode,
  target,
  onCommit,
  onCancel,
  autoFocus,
}: {
  initialText: string
  mode: HMEntityFieldMode
  /** Document mode: search documents typed by this schema or a subtype first. */
  target?: string
  onCommit: (value: string) => void
  onCancel?: () => void
  autoFocus?: boolean
}) {
  const [text, setText] = useState(initialText)
  const [focused, setFocused] = useState(false)
  const [resolving, setResolving] = useState(false)
  // The platform's domain store answers first (cached, offline); the site's own answer is the fallback.
  const {domainResolver} = useUniversalAppContext()
  const isUrlInput = /^(hm|ipfs|https?):\/\//i.test(text.trim())
  const search = useSearch(text.trim(), {enabled: mode !== 'schema' && text.trim().length > 0 && !isUrlInput})
  // Schema mode offers only pages that DEFINE a schema (carry `schemaDefinition`), through the
  // attribute query — by name when text is typed, the latest ones when the field is empty — so
  // whatever is picked resolves to a schema. Text and profile modes use full-text search.
  const schemaPages = useSchemaDocumentSearch(text, {enabled: mode === 'schema' && !isUrlInput})
  // A targeted document field offers documents typed by the target or a subtype first — the
  // latest ones while the field is empty, by name once text is typed — through the attribute
  // query. Full-text matches of other types follow, marked, so a link outside the type is still
  // one click away (the constraint is advisory).
  const typed = useTypedDocumentSearch(target, text, {
    enabled: !!target && !isUrlInput && (focused || text.trim().length > 0),
  })
  const targetName = useHmRefTitle(target ?? '')
  const fullText: SearchResult[] = (search.data?.entities ?? [])
    .filter((entity) => {
      if (entity.type === 'comment') return false
      // Profiles are account-root documents: a uid with no path.
      if (mode === 'profile') return !entity.id.path?.length
      return true
    })
    .map((entity) => ({id: entity.id, title: entity.title || entity.id.id}))
  const typedResults: SearchResult[] = (typed.data ?? [])
    .slice(0, 6)
    .map((info) => ({id: info.id, title: getMetadataName(info.metadata) || info.id.id}))
  const typedIds = new Set(typedResults.map((result) => result.id.id))
  const results: SearchResult[] =
    mode === 'schema'
      ? (schemaPages.data ?? []).map((info) => ({id: info.id, title: getMetadataName(info.metadata) || info.id.id}))
      : target
        ? [
            ...typedResults,
            ...fullText
              .filter((result) => !typedIds.has(result.id.id))
              .slice(0, 3)
              .map((result) => ({...result, offType: true})),
          ]
        : fullText.slice(0, 6)

  const commitText = async () => {
    // Commit whatever was typed — validation stays advisory (a warning badge,
    // never a block). A pasted hm:// URL that fits the mode just conforms.
    // Unchanged text commits nothing: blurring an untouched empty field must not write it.
    if (text === initialText) {
      onCancel?.()
      return
    }
    const trimmed = text.trim()
    // A pasted web link (a site or gateway URL) names a document only once the site has been
    // asked which account and path it serves: resolve it to the canonical hm:// URL, the same
    // way the omnibar does. An unresolvable link commits as typed, so the warning can say so.
    if (/^https?:\/\//i.test(trimmed)) {
      setResolving(true)
      try {
        const resolved = await resolveHypermediaUrl(trimmed, {domainResolver})
        if (resolved?.hmId) {
          const id = mode === 'profile' ? {...resolved.hmId, path: null} : resolved.hmId
          onCommit(packHmId({...id, version: null, latest: null, blockRef: null, blockRange: null}))
          return
        }
      } catch {
        // fall through: commit the text as typed
      } finally {
        setResolving(false)
      }
    }
    onCommit(text)
  }

  return (
    <div className="relative flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-1">
        <Input
          value={text}
          autoFocus={autoFocus}
          placeholder={
            mode === 'profile'
              ? 'Search accounts or paste hm:// URL'
              : mode === 'schema'
                ? 'Search schema pages, or paste an hm:// or ipfs:// reference'
                : target
                  ? `Search ${targetName.title ?? 'typed'} pages or paste hm:// URL`
                  : 'Search documents or paste hm:// URL'
          }
          className="h-8 min-w-52"
          disabled={resolving}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commitText()
            if (e.key === 'Escape') (onCancel ?? (() => void commitText()))()
          }}
          onBlur={(e) => {
            // Clicking a search result blurs the input; let the click win.
            const next = e.relatedTarget as HTMLElement | null
            if (next?.closest('[data-hm-search-results]')) return
            setFocused(false)
            void commitText()
          }}
        />
        {onCancel && (
          <Button
            variant="ghost"
            size="iconSm"
            aria-label="Cancel"
            className="text-muted-foreground"
            onClick={onCancel}
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>
      {results.length > 0 && (focused || text.trim().length > 0) && (
        <div
          data-hm-search-results
          className="bg-popover border-border absolute top-full right-0 left-0 z-50 mt-1 flex flex-col overflow-hidden rounded-md border shadow-md"
        >
          {results.map((entity) => (
            <button
              key={packHmId(entity.id)}
              data-testid="hm-search-result"
              data-off-type={entity.offType ? 'true' : undefined}
              title={entity.offType ? `Not a ${targetName.title ?? 'matching'} page` : undefined}
              className={cn(
                'hover:bg-accent focus:bg-accent flex min-w-0 items-center gap-2 px-2 py-1.5 text-left text-sm outline-none',
                entity.offType && 'text-muted-foreground',
              )}
              onClick={() => {
                // A reference names the document, not a version of it (a listing's id carries the
                // version it was read at). Profiles store the bare account URL, no path either.
                const document = {...entity.id, version: null, latest: null, blockRef: null, blockRange: null}
                onCommit(packHmId(mode === 'profile' ? {...document, path: null} : document))
              }}
            >
              {entity.offType ? (
                <TriangleAlert className="text-muted-foreground size-3.5 shrink-0" />
              ) : mode === 'profile' ? (
                <User className="text-muted-foreground size-3.5 shrink-0" />
              ) : mode === 'schema' ? (
                <FileCode2 className="text-muted-foreground size-3.5 shrink-0" />
              ) : (
                <FileText className="text-muted-foreground size-3.5 shrink-0" />
              )}
              <span className="truncate">{entity.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
