import {
  BUILTIN_METADATA_KEYS,
  type HMDocumentInfo,
  type HMQueryBlockInput,
  type HMQueryBlockFilterOptions,
} from '@seed-hypermedia/client/hm-types'
import {normalizeDate} from '../utils/date'

/** Temporary viewer search and filters. */
export type QueryBlockViewer = NonNullable<HMQueryBlockInput['viewer']>
/** One temporary viewer filter condition. */
export type QueryBlockViewerFilter = NonNullable<QueryBlockViewer['filters']>[number]

function valueFor(item: HMDocumentInfo, columnId: string): unknown {
  if (columnId.startsWith('metadata:')) return item.metadata[columnId.slice('metadata:'.length)]
  if (columnId === 'title') return item.metadata.name || item.path.at(-1) || 'Untitled'
  if (columnId === 'path') return item.path.join('/')
  if (columnId === 'tags') return item.metadata.tags ?? item.metadata.importTags
  if (columnId === 'created') return item.createTime
  if (columnId === 'updated') return item.updateTime
  if (columnId === 'children') return item.activitySummary?.childrenCount ?? 0
  if (columnId === 'comments') return item.activitySummary?.commentCount ?? 0
  return undefined
}

function text(value: unknown): string {
  if (value == null) return ''
  if (Array.isArray(value)) return value.map(text).join(', ')
  if (typeof value === 'object') return ''
  return String(value)
}

function comparable(value: unknown, columnId: string): string | number {
  if (columnId === 'created' || columnId === 'updated') {
    return normalizeDate(value as Parameters<typeof normalizeDate>[0])?.getTime() ?? Number.NaN
  }
  const numeric = Number(value)
  if (value !== '' && Number.isFinite(numeric)) return numeric
  return text(value).toLocaleLowerCase()
}

function matchesFilter(item: HMDocumentInfo, filter: QueryBlockViewerFilter): boolean {
  const value = valueFor(item, filter.columnId)
  const needle = filter.value.trim().toLocaleLowerCase()
  if (!needle) return true
  if (filter.operator === 'equals' || filter.operator === 'notEquals') {
    const comparableValue =
      filter.columnId === 'created' || filter.columnId === 'updated'
        ? normalizeDate(value as Parameters<typeof normalizeDate>[0])?.toISOString()
        : filter.columnId === 'tags' && typeof value === 'string'
          ? value
              .split(',')
              .map((tag) => tag.trim())
              .filter(Boolean)
          : value
    const matches = matchesQueryFilterEquality(comparableValue, filter.value)
    return filter.operator === 'equals' ? matches : !matches
  }
  if (filter.operator === 'contains') return text(value).toLocaleLowerCase().includes(needle)
  const left = comparable(value, filter.columnId)
  const right = comparable(filter.value, filter.columnId)
  if (typeof left === 'number' && typeof right === 'number' && (!Number.isFinite(left) || !Number.isFinite(right))) {
    return false
  }
  return filter.operator === 'greaterThan' ? left > right : left < right
}

function scalarOption(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return undefined
  const result = String(value)
  return result.trim() ? result : undefined
}

/** Matches a scalar or any scalar array element, without matching case. */
export function matchesQueryFilterEquality(value: unknown, expected: string): boolean {
  const needle = expected.toLocaleLowerCase()
  return (Array.isArray(value) ? value : [value]).some((entry) => scalarOption(entry)?.toLocaleLowerCase() === needle)
}

/** Collects existing filter values and column types from all documents in the collection scope. */
export function getQueryBlockFilterOptions(items: HMDocumentInfo[]): HMQueryBlockFilterOptions {
  const columns: Record<string, HMQueryBlockFilterOptions[string]['type']> = {
    title: 'text',
    path: 'text',
    tags: 'list',
    created: 'date',
    updated: 'date',
    children: 'number',
    comments: 'number',
  }
  const metadataKeys = new Set(
    items.flatMap((item) => Object.keys(item.metadata).filter((key) => !BUILTIN_METADATA_KEYS.has(key))),
  )
  for (const key of Array.from(metadataKeys)) {
    const present = items.map((item) => item.metadata[key]).filter((value) => value != null && value !== '')
    let type: HMQueryBlockFilterOptions[string]['type'] = 'text'
    if (present.length) {
      if (present.every((value) => typeof value === 'number')) type = 'number'
      else if (present.every((value) => typeof value === 'boolean')) type = 'boolean'
      else if (present.every(Array.isArray)) type = 'list'
      else if (
        present.every(
          (value) =>
            typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) && !Number.isNaN(Date.parse(value)),
        )
      )
        type = 'date'
    }
    columns[`metadata:${key}`] = type
  }
  return Object.fromEntries(
    Object.entries(columns).map(([columnId, type]) => {
      const values: string[] = []
      const seen = new Set<string>()
      for (const item of items) {
        let raw = valueFor(item, columnId)
        if (columnId === 'tags' && typeof raw === 'string')
          raw = raw
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean)
        if (columnId === 'created' || columnId === 'updated')
          raw = normalizeDate(raw as Parameters<typeof normalizeDate>[0])?.toISOString()
        for (const entry of Array.isArray(raw) ? raw : [raw]) {
          const value = scalarOption(entry)
          if (value === undefined || seen.has(value.toLocaleLowerCase())) continue
          seen.add(value.toLocaleLowerCase())
          values.push(value)
        }
      }
      return [columnId, {type, values}]
    }),
  )
}

/** Applies temporary viewer search and filters to a complete Query Block result set. */
export function filterQueryBlockDocuments(items: HMDocumentInfo[], viewer?: QueryBlockViewer): HMDocumentInfo[] {
  const search = viewer?.search?.trim().toLocaleLowerCase()
  const filters = viewer?.filters ?? []
  if (!search && !filters.some((filter) => filter.value.trim())) return items

  return items.filter((item) => {
    if (search) {
      const searchable = [item.metadata.name, item.path.join('/'), ...Object.values(item.metadata)]
        .map(text)
        .join('\n')
        .toLocaleLowerCase()
      if (!searchable.includes(search)) return false
    }
    return filters.every((filter) => matchesFilter(item, filter))
  })
}
