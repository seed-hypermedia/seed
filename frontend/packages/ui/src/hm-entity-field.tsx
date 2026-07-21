import {getMetadataName} from '@shm/shared/content'
import {useResource} from '@shm/shared/models/entity'
import {useSearch} from '@shm/shared/models/search'
import {packHmId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {FileText, Pencil, User, X} from 'lucide-react'
import {useState} from 'react'
import {Button} from './button'
import {Input} from './components/input'
import {Tooltip} from './tooltip'
import {cn} from './utils'

/**
 * Editor for schema fields holding hypermedia references as `hm://` URL
 * strings — `format: "hm-url"` (any document) and `format: "hm-profile"`
 * (a bare account URL, no path). A resolvable value displays as the
 * document/profile TITLE, not the raw URL; editing offers live search over
 * documents (or accounts only, for profiles) alongside direct URL pasting.
 * Advisory like everything schema-driven: any text can be committed — a
 * non-conforming value simply keeps the plain input and its warning badge.
 */
export function HMEntityField({
  value,
  mode,
  onValue,
  onOpen,
}: {
  value: string
  mode: 'document' | 'profile'
  onValue: (value: unknown) => void
  /** Navigate to the referenced document/account when the pill is clicked. */
  onOpen?: (url: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const unpacked = value ? unpackHmId(value) : null
  const conforms = !!unpacked && (mode === 'document' || !unpacked.path?.length)

  if (conforms && !editing) {
    return (
      <div className="flex min-w-0 items-center gap-1">
        <HMEntityLink url={value} mode={mode} onOpen={onOpen} />
        <Tooltip content={`Change (${unpacked.id})`}>
          <Button
            variant="ghost"
            size="iconSm"
            aria-label={`Change ${mode === 'profile' ? 'profile' : 'document'}`}
            className="text-muted-foreground"
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-3.5" />
          </Button>
        </Tooltip>
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
  mode?: 'document' | 'profile'
  onOpen?: (url: string) => void
}) {
  const id = url ? unpackHmId(url) : null
  const resource = useResource(id)
  const document = resource.data && 'document' in resource.data ? resource.data.document : undefined
  const title = getMetadataName(document?.metadata) || undefined
  const isProfile = mode === 'profile' || (!!id && !id.path?.length)
  const Icon = isProfile ? User : FileText
  const label = title ?? (resource.isLoading ? 'Loading…' : id?.id ?? url)

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
}: {
  initialText: string
  mode: 'document' | 'profile'
  onCommit: (value: string) => void
  onCancel?: () => void
}) {
  const [text, setText] = useState(initialText)
  const isUrlInput = text.trim().startsWith('hm://')
  const search = useSearch(text.trim(), {enabled: text.trim().length > 0 && !isUrlInput})
  const results = (search.data?.entities ?? [])
    .filter((entity) => {
      if (entity.type === 'comment') return false
      // Profiles are account-root documents: a uid with no path.
      if (mode === 'profile') return !entity.id.path?.length
      return true
    })
    .slice(0, 6)

  const commitText = () => {
    // Commit whatever was typed — validation stays advisory (a warning badge,
    // never a block). A pasted hm:// URL that fits the mode just conforms.
    if (text !== initialText || !onCancel) onCommit(text)
    else onCancel()
  }

  return (
    <div className="relative flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-1">
        <Input
          value={text}
          autoFocus
          placeholder={
            mode === 'profile' ? 'Search accounts or paste hm:// URL' : 'Search documents or paste hm:// URL'
          }
          className="h-8 min-w-52"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitText()
            if (e.key === 'Escape') (onCancel ?? commitText)()
          }}
          onBlur={(e) => {
            // Clicking a search result blurs the input; let the click win.
            const next = e.relatedTarget as HTMLElement | null
            if (next?.closest('[data-hm-search-results]')) return
            commitText()
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
              ) : (
                <FileText className="text-muted-foreground size-3.5 shrink-0" />
              )}
              <span className="truncate">{entity.title || entity.id.id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
