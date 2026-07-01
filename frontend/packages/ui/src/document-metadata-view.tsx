import type {HMMetadata} from '@seed-hypermedia/client/hm-types'

function formatMetadataValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value, null, 2)
}

/** Read-only listing of a document's metadata fields, shown on the `:metadata` view. */
export function DocumentMetadataView({metadata}: {metadata?: HMMetadata | null}) {
  const entries = Object.entries(metadata ?? {}).filter(
    ([, value]) => value !== undefined && value !== null && value !== '',
  )
  return (
    <div className="flex flex-col gap-4 py-6">
      <h2 className="text-2xl font-bold">Metadata</h2>
      {entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">This document has no metadata.</p>
      ) : (
        <dl className="flex flex-col gap-3">
          {entries.map(([key, value]) => (
            <div key={key} className="border-border flex flex-col gap-1 border-b pb-3 last:border-b-0">
              <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{key}</dt>
              <dd className="font-mono text-sm break-words whitespace-pre-wrap">{formatMetadataValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
