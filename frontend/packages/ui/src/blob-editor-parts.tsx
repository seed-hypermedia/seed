// Pieces of the blob editor (the inspector's draft mode): the schema status
// line, the attach-schema bar, and the raw JSON editing mode. Shared by desktop
// and web through InspectIpfsPage.
import {Check, FileCode2, Link2, TriangleAlert} from 'lucide-react'
import {useMemo, useState} from 'react'
import {Button} from './button'
import {Input} from './components/input'
import {Textarea} from './components/textarea'
import {parseCidString} from './dag-json'
import {useSchemaWarningCount, useSchemaWarnings} from './onyx/onyx-schema-context'
import {Spinner} from './spinner'
import {cn} from './utils'

const DAG_CBOR_CODE = 0x71

/**
 * One quiet line about the schema in play: whether the blob is itself a schema
 * or carries an attached one, whether it loaded, and how many advisory warnings
 * the current value has. Warnings never block editing or publishing.
 */
export function SchemaStatusRow({
  attachedSchemaCid,
  valueIsSchema,
  schemaLoaded,
  schemaLoading,
  onOpenSchema,
}: {
  attachedSchemaCid: string | undefined
  valueIsSchema: boolean
  schemaLoaded: boolean
  schemaLoading: boolean
  onOpenSchema?: () => void
}) {
  const warningCount = useSchemaWarningCount()
  // Root-level warnings (missing required keys, root type mismatch…) have no
  // field row to badge, so they surface here.
  const rootWarnings = useSchemaWarnings([])
  if (!attachedSchemaCid && !valueIsSchema) return null
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="schema-status-row">
      <span className="text-muted-foreground flex items-center gap-1">
        <FileCode2 className="size-3.5" />
        {valueIsSchema ? 'This blob is a schema' : 'Schema attached'}
      </span>
      {!valueIsSchema && attachedSchemaCid && (
        <button
          className={cn(
            'text-muted-foreground flex max-w-56 items-center gap-1 truncate font-mono',
            onOpenSchema && 'hover:underline',
          )}
          onClick={onOpenSchema}
          disabled={!onOpenSchema}
        >
          <Link2 className="size-3 shrink-0" />
          <span className="truncate">{attachedSchemaCid}</span>
        </button>
      )}
      {schemaLoading && (
        <span className="text-muted-foreground flex items-center gap-1">
          <Spinner className="size-3" />
          Loading schema…
        </span>
      )}
      {schemaLoaded && warningCount > 0 && (
        <span className="flex items-center gap-1 text-amber-600 dark:text-amber-500">
          <TriangleAlert className="size-3.5" />
          {warningCount} field{warningCount === 1 ? " doesn't" : "s don't"} match the schema — kept as-is
          {rootWarnings.length > 0 && <>: {rootWarnings.map((warning) => warning.message).join('; ')}</>}
        </span>
      )}
      {schemaLoaded && warningCount === 0 && !valueIsSchema && (
        <span className="text-muted-foreground flex items-center gap-1">
          <Check className="size-3" />
          Matches schema
        </span>
      )}
    </div>
  )
}

/** Inline bar for attaching a schema by CID or ipfs:// URL. */
export function AttachSchemaBar({
  replacesUserData,
  onAttach,
  onCancel,
}: {
  /** The value already has a non-attachment `schema` field the attach would replace. */
  replacesUserData?: boolean
  onAttach: (cid: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    const cidText = text.trim().replace(/^ipfs:\/\//, '')
    const parsed = parseCidString(cidText)
    if (!parsed) {
      setError('Enter a valid CID or ipfs:// URL')
      return
    }
    if (parsed.code !== DAG_CBOR_CODE) {
      setError('Schemas are DAG-CBOR blobs — this CID has a different codec')
      return
    }
    onAttach(cidText)
  }

  return (
    <div className="border-border flex flex-col gap-2 rounded-md border border-dashed p-3">
      {replacesUserData && (
        <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
          <TriangleAlert className="size-3.5 shrink-0" />
          This blob already has a "schema" field with its own data — attaching will replace it (undo restores it).
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={text}
          placeholder="Schema CID or ipfs:// URL"
          className="min-w-64 flex-1 font-mono text-xs"
          autoFocus
          onChange={(e) => {
            setText(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') onCancel()
          }}
        />
        <Button size="sm" variant={replacesUserData ? 'destructive' : 'default'} onClick={submit}>
          <Check className="size-4" />
          {replacesUserData ? 'Replace "schema" field' : 'Attach'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  )
}

/** The raw escape hatch: edit the whole blob as dag-json text (links and bytes in their `{"/": …}` forms), then apply. */
export function BlobJsonMode({
  value,
  onApply,
  onCancel,
}: {
  value: unknown
  onApply: (value: unknown) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2))

  const validation = useMemo(() => {
    try {
      return {value: JSON.parse(text) as unknown}
    } catch (e) {
      return {error: e instanceof Error ? e.message : 'Invalid JSON'}
    }
  }, [text])

  return (
    <div className="flex flex-col gap-2" data-testid="blob-json-mode">
      <Textarea
        value={text}
        rows={Math.max(12, Math.min(36, text.split('\n').length + 1))}
        spellCheck={false}
        autoFocus
        className={cn('font-mono text-sm', 'error' in validation && 'border-destructive')}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex min-h-8 items-center gap-2">
        <Button size="sm" disabled={!('value' in validation)} onClick={() => onApply((validation as any).value)}>
          <Check className="size-4" />
          Apply
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        {'error' in validation && <p className="text-destructive text-xs">{validation.error}</p>}
      </div>
    </div>
  )
}

/** The published blob as raw dag-json text: JSON with IPLD links/bytes in their `{"/": …}` envelopes. */
export function RawDagJsonView({value}: {value: unknown}) {
  return (
    <pre
      className="bg-background overflow-x-auto rounded-md border p-4 font-mono text-sm whitespace-pre-wrap"
      data-testid="raw-dag-json"
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}
