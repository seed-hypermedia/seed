import {resolveHypermediaUrl} from '@seed-hypermedia/client'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {getMetadataName} from '@shm/shared/content'
import {useResource} from '@shm/shared/models/entity'
import {useSchemaDocumentSearch} from '@shm/shared/models/schema-documents'
import {useSearch} from '@shm/shared/models/search'
import {useUniversalAppContext} from '@shm/shared/routing'
import {packHmId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {FileCode2, FileText, User, X} from 'lucide-react'
import {useState} from 'react'
import {Button} from './button'
import {Input} from './components/input'
import {HM_SCHEMAS, refToName} from './schema/engine'
import {HM_SCHEMA_PAGES} from './schema/schema-registry.generated'
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
 */
export type HMEntityFieldMode = 'document' | 'profile' | 'schema'

export function HMEntityField({
  value,
  mode,
  onValue,
  onOpen,
  onClear,
  autoFocus,
}: {
  value: string
  mode: HMEntityFieldMode
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

  if (conforms && !editing) {
    return (
      <div className="flex min-w-0 items-center gap-1">
        <HMEntityLink url={value} mode={mode} onOpen={onOpen} />
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
  // Only an hm:// document has a title to fetch; an ipfs:// or other reference shows as it is.
  const resource = useResource(id)
  const document = resource.data && 'document' in resource.data ? resource.data.document : undefined
  // A reference to a library type (a `type` or `ref` in a schema) is named by
  // its bundled page even when the site does not carry that page (yet).
  const slug = url.startsWith('hm://') ? refToName(url) : ''
  const library = slug && HM_SCHEMAS[slug] ? slug : null
  const title = document
    ? getMetadataName(document.metadata)
    : library
      ? HM_SCHEMA_PAGES[library]?.name ?? library
      : undefined
  const isProfile = mode === 'profile' || (!!id && !id.path?.length)
  const Icon = library || mode === 'schema' ? FileCode2 : isProfile ? User : FileText
  const label = title ?? (id && resource.isLoading ? 'Loading…' : id?.id ?? url)

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

function HMEntitySearchInput({
  initialText,
  mode,
  onCommit,
  onCancel,
  autoFocus,
}: {
  initialText: string
  mode: HMEntityFieldMode
  onCommit: (value: string) => void
  onCancel?: () => void
  autoFocus?: boolean
}) {
  const [text, setText] = useState(initialText)
  const [resolving, setResolving] = useState(false)
  // The platform's domain store answers first (cached, offline); the site's own answer is the fallback.
  const {domainResolver} = useUniversalAppContext()
  const isUrlInput = /^(hm|ipfs|https?):\/\//i.test(text.trim())
  const search = useSearch(text.trim(), {enabled: mode !== 'schema' && text.trim().length > 0 && !isUrlInput})
  // Schema mode offers only pages that DEFINE a schema (carry `schemaDefinition`), through the
  // attribute query — by name when text is typed, the latest ones when the field is empty — so
  // whatever is picked resolves to a schema. Text and profile modes use full-text search.
  const schemaPages = useSchemaDocumentSearch(text, {enabled: mode === 'schema' && !isUrlInput})
  const results: Array<{id: UnpackedHypermediaId; title: string}> =
    mode === 'schema'
      ? (schemaPages.data ?? []).map((info) => ({id: info.id, title: getMetadataName(info.metadata) || info.id.id}))
      : (search.data?.entities ?? [])
          .filter((entity) => {
            if (entity.type === 'comment') return false
            // Profiles are account-root documents: a uid with no path.
            if (mode === 'profile') return !entity.id.path?.length
            return true
          })
          .slice(0, 6)
          .map((entity) => ({id: entity.id, title: entity.title || entity.id.id}))

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
                : 'Search documents or paste hm:// URL'
          }
          className="h-8 min-w-52"
          disabled={resolving}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commitText()
            if (e.key === 'Escape') (onCancel ?? (() => void commitText()))()
          }}
          onBlur={(e) => {
            // Clicking a search result blurs the input; let the click win.
            const next = e.relatedTarget as HTMLElement | null
            if (next?.closest('[data-hm-search-results]')) return
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
      {results.length > 0 && (
        <div
          data-hm-search-results
          className="bg-popover border-border absolute top-full right-0 left-0 z-50 mt-1 flex flex-col overflow-hidden rounded-md border shadow-md"
        >
          {results.map((entity) => (
            <button
              key={packHmId(entity.id)}
              className="hover:bg-accent focus:bg-accent flex min-w-0 items-center gap-2 px-2 py-1.5 text-left text-sm outline-none"
              onClick={() => {
                // Profiles store the bare account URL, no path or version.
                const id = mode === 'profile' ? {...entity.id, path: null, version: null} : entity.id
                onCommit(packHmId(id))
              }}
            >
              {mode === 'profile' ? (
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
