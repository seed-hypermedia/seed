import {
  BUILTIN_METADATA_KEYS,
  type HMAccountsMetadata,
  type HMDocumentInfo,
  type HMQueryBlockItemSummary,
} from '@seed-hypermedia/client/hm-types'
import {formattedDate, normalizeDate, type AnyTimestamp} from '@shm/shared'

/** Primitive presentation types inferred for custom Query table attributes. */
export type QueryTableAttributeType = 'text' | 'number' | 'boolean' | 'date' | 'list'

/** A discovered or built-in Query table column. */
export type QueryTableColumn = {
  id: string
  label: string
  type: QueryTableAttributeType
  defaultVisible: boolean
}

/** One ephemeral client-side Query table filter. */
export type QueryTableFilter = {
  columnId: string
  operator: 'contains' | 'equals' | 'greaterThan' | 'lessThan'
  value: string
}

/** Contextual data used to resolve column values that depend on derived data. */
export type QueryTableValueContext = {
  accountsMetadata?: HMAccountsMetadata
  interactionSummaries?: Record<string, HMQueryBlockItemSummary>
  citationCounts?: Record<string, number>
}

/** Infers one simple table type from the non-empty values of an attribute. */
export function inferAttributeType(values: unknown[]): QueryTableAttributeType {
  const present = values.filter((value) => value !== null && value !== undefined && value !== '')
  if (present.length === 0) return 'text'
  if (present.every((value) => typeof value === 'number')) return 'number'
  if (present.every((value) => typeof value === 'boolean')) return 'boolean'
  if (present.every(Array.isArray)) return 'list'
  if (
    present.every(
      (value) =>
        typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) && !Number.isNaN(Date.parse(value)),
    )
  ) {
    return 'date'
  }
  return 'text'
}

/** Builds the stable core columns for Query table rows. */
export function buildQueryTableColumns(): QueryTableColumn[] {
  return [
    {id: 'title', label: 'Name', type: 'text', defaultVisible: true},
    {id: 'tags', label: 'Tags', type: 'list', defaultVisible: true},
    {id: 'updated', label: 'Last Modified', type: 'date', defaultVisible: true},
    {id: 'children', label: 'Subdocuments', type: 'number', defaultVisible: true},
    {id: 'comments', label: 'Comments', type: 'number', defaultVisible: true},
    {id: 'citations', label: 'Backlinks', type: 'number', defaultVisible: true},
    {id: 'authors', label: 'Authors', type: 'list', defaultVisible: false},
    {id: 'created', label: 'Created', type: 'date', defaultVisible: false},
    {id: 'path', label: 'Path', type: 'text', defaultVisible: false},
  ]
}

/** Extracts the list of tag values for a document from its metadata. */
export function getDocumentTags(item: HMDocumentInfo): string[] {
  const raw = item.metadata.tags ?? item.metadata.importTags
  if (typeof raw === 'string' && raw) {
    return raw
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
  }
  if (Array.isArray(raw)) {
    return raw.map(String).filter(Boolean)
  }
  const tags: string[] = []
  for (const [key, value] of Object.entries(item.metadata)) {
    if (BUILTIN_METADATA_KEYS.has(key)) continue
    if (typeof value === 'string' && value) {
      tags.push(value)
    } else if (Array.isArray(value)) {
      for (const v of value) {
        if (typeof v === 'string' && v) tags.push(v)
      }
    }
  }
  return tags
}

/** Returns the value addressed by a stable Query table column ID. */
export function getQueryTableValue(item: HMDocumentInfo, columnId: string, context?: QueryTableValueContext): unknown {
  if (columnId.startsWith('metadata:')) return item.metadata[columnId.slice('metadata:'.length)]
  if (columnId === 'title') return item.metadata.name || item.path.at(-1) || 'Untitled'
  if (columnId === 'tags') return getDocumentTags(item)
  if (columnId === 'comments') {
    const summaryId = item.id?.id ?? item.id
    return context?.interactionSummaries?.[summaryId]?.comments ?? item.activitySummary?.commentCount ?? 0
  }
  if (columnId === 'citations') {
    const summaryId = item.id?.id ?? item.id
    return context?.citationCounts?.[summaryId] ?? 0
  }
  if (columnId === 'updated') return item.updateTime
  if (columnId === 'created') return item.createTime
  if (columnId === 'authors') {
    const authors = Array.isArray(item.authors) ? item.authors : []
    return authors
      .map((uid) => context?.accountsMetadata?.[uid]?.metadata?.name || uid)
      .filter(Boolean)
      .join(', ')
  }
  if (columnId === 'path') return item.path.join('/')
  if (columnId === 'children') {
    const summaryId = item.id?.id ?? item.id
    return context?.interactionSummaries?.[summaryId]?.children ?? item.activitySummary?.childrenCount ?? 0
  }
  return undefined
}

/** Turns a raw table value into a plain string for display or text filtering. */
export function queryTableValueToString(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(queryTableValueToString).join(', ')
  if (isTimestampValue(value)) return formattedDate(value as AnyTimestamp)
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function isTimestampValue(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('seconds' in value || value instanceof Date || (typeof value === 'string' && !Number.isNaN(Date.parse(value))))
  )
}

/** Returns a primitive that can be used to compare two rows for a given column. */
export function getQueryTableSortValue(
  item: HMDocumentInfo,
  columnId: string,
  context?: QueryTableValueContext,
): string | number {
  const value = getQueryTableValue(item, columnId, context)
  if (columnId === 'updated' || columnId === 'created') {
    const date = normalizeDate(value as AnyTimestamp)
    return date?.getTime() ?? 0
  }
  if (columnId === 'title' || columnId === 'tags' || columnId === 'authors') {
    return queryTableValueToString(value).toLocaleLowerCase()
  }
  if (columnId === 'children' || columnId === 'comments' || columnId === 'citations') {
    return Number(value) || 0
  }
  if (Array.isArray(value)) return queryTableValueToString(value).toLocaleLowerCase()
  if (typeof value === 'number') return value
  return queryTableValueToString(value).toLocaleLowerCase()
}

/** Tests the global search against every available value in a Query table row. */
export function queryTableItemMatchesSearch(
  item: HMDocumentInfo,
  search: string,
  descriptors: QueryTableColumn[],
  context?: QueryTableValueContext,
): boolean {
  const normalized = search.trim().toLocaleLowerCase()
  if (!normalized) return true
  const text = descriptors
    .map((column) => queryTableValueToString(getQueryTableValue(item, column.id, context)).toLocaleLowerCase())
    .join('\n')
  return text.includes(normalized)
}

/** Applies temporary Query table filters using AND semantics. */
export function filterQueryTableItems(
  items: HMDocumentInfo[],
  filters: QueryTableFilter[],
  context?: QueryTableValueContext,
): HMDocumentInfo[] {
  return items.filter((item) =>
    filters.every((filter) => {
      const value = getQueryTableValue(item, filter.columnId, context)
      const text = queryTableValueToString(value)
      if (filter.operator === 'contains') return text.toLocaleLowerCase().includes(filter.value.toLocaleLowerCase())
      if (filter.operator === 'equals') return text.toLocaleLowerCase() === filter.value.toLocaleLowerCase()
      const left = Number(value)
      const right = Number(filter.value)
      if (!Number.isFinite(left) || !Number.isFinite(right)) return false
      return filter.operator === 'greaterThan' ? left > right : left < right
    }),
  )
}

/** Moves one Query table column by a relative offset. */
export function moveQueryTableColumn(order: string[], columnId: string, offset: -1 | 1): string[] {
  const from = order.indexOf(columnId)
  const to = from + offset
  if (from < 0 || to < 0 || to >= order.length) return order
  const next = [...order]
  ;[next[from], next[to]] = [next[to]!, next[from]!]
  return next
}
