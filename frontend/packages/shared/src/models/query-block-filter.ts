import type {HMDocumentInfo, HMQueryBlockInput} from '@seed-hypermedia/client/hm-types'
import {normalizeDate} from '../utils'

export type QueryBlockViewer = NonNullable<HMQueryBlockInput['viewer']>
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
  if (filter.operator === 'contains' || filter.operator === 'equals') {
    const haystack = text(value).toLocaleLowerCase()
    return filter.operator === 'contains' ? haystack.includes(needle) : haystack === needle
  }
  const left = comparable(value, filter.columnId)
  const right = comparable(filter.value, filter.columnId)
  if (typeof left === 'number' && typeof right === 'number' && (!Number.isFinite(left) || !Number.isFinite(right))) {
    return false
  }
  return filter.operator === 'greaterThan' ? left > right : left < right
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
