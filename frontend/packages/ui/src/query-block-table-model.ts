import {BUILTIN_METADATA_KEYS, type HMDocumentInfo} from '@seed-hypermedia/client/hm-types'

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

/** Builds the stable core and discovered custom columns for Query table rows. */
export function buildQueryTableColumns(items: HMDocumentInfo[]): QueryTableColumn[] {
  const keys = new Set<string>()
  for (const item of items) {
    for (const [key, value] of Object.entries(item.metadata)) {
      if (!BUILTIN_METADATA_KEYS.has(key) && value !== null && value !== undefined) keys.add(key)
    }
  }
  const custom = Array.from(keys)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => ({
      id: `metadata:${key}`,
      label: key,
      type: inferAttributeType(items.map((item) => item.metadata[key])),
      defaultVisible: true,
    }))

  return [
    {id: 'title', label: 'Title', type: 'text', defaultVisible: true},
    ...custom,
    {id: 'comments', label: 'Comments', type: 'number', defaultVisible: true},
    {id: 'citations', label: 'Citations', type: 'number', defaultVisible: true},
    {id: 'updated', label: 'Updated', type: 'date', defaultVisible: true},
    {id: 'authors', label: 'Authors', type: 'list', defaultVisible: true},
    {id: 'created', label: 'Created', type: 'date', defaultVisible: false},
    {id: 'path', label: 'Path', type: 'text', defaultVisible: false},
    {id: 'children', label: 'Children', type: 'number', defaultVisible: false},
  ] as QueryTableColumn[]
}

/** Returns the value addressed by a stable Query table column ID. */
export function getQueryTableValue(item: HMDocumentInfo, columnId: string): unknown {
  if (columnId.startsWith('metadata:')) return item.metadata[columnId.slice('metadata:'.length)]
  if (columnId === 'title') return item.metadata.name || item.path.at(-1) || 'Untitled'
  if (columnId === 'comments') return item.activitySummary?.commentCount ?? 0
  if (columnId === 'updated') return item.updateTime
  if (columnId === 'created') return item.createTime
  if (columnId === 'authors') return item.authors
  if (columnId === 'path') return item.path.join('/')
  if (columnId === 'children') return item.activitySummary?.childrenCount ?? 0
  return undefined
}

/** Tests the global search against every available value in a Query table row. */
export function queryTableItemMatchesSearch(item: HMDocumentInfo, search: string): boolean {
  const normalized = search.trim().toLocaleLowerCase()
  if (!normalized) return true
  return [item.metadata, item.path, item.authors, item.createTime, item.updateTime, item.activitySummary]
    .map((value) => JSON.stringify(value).toLocaleLowerCase())
    .some((value) => value.includes(normalized))
}

/** Applies temporary Query table filters using AND semantics. */
export function filterQueryTableItems(items: HMDocumentInfo[], filters: QueryTableFilter[]): HMDocumentInfo[] {
  return items.filter((item) =>
    filters.every((filter) => {
      const value = getQueryTableValue(item, filter.columnId)
      const text = Array.isArray(value) ? value.join(', ') : String(value ?? '')
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
