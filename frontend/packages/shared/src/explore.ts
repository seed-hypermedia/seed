import type {JsonValue} from '@bufbuild/protobuf'
import {
  compileExploreQuery as compileExploreQueryJson,
  parseExploreQuery,
  quoteExploreValue,
  serializeExploreQuery,
  type ExploreAttributePredicate,
  type ExploreCompilation as ExploreCompilationJson,
  type ExploreQueryNode,
  type ExploreScalar,
  type ExploreScopePredicate,
  type ExploreSortRule,
  type ExploreTimeComparison,
  type ExploreTimeField,
  type HMExploreResultType,
  type ParsedExploreQuery,
} from '@seed-hypermedia/client/explore-query'
import type {HMDocumentInfo, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {DocumentFilter} from './client/grpc-types'
import type {SearchResultItem} from './models/search'
import {packHmId} from './utils/entity-id-url'

// The grammar, parser, serializer, and JSON compiler live in the client SDK
// (`@seed-hypermedia/client/explore-query`) so the CLI and the agents service speak the same
// language; this module keeps the app-facing pieces — result models, chips, and the compiler
// wrapper that yields protobuf message instances.
export {
  parseExploreQuery,
  quoteExploreValue,
  serializeExploreQuery,
  type ExploreAttributePredicate,
  type ExploreComparisonOperator,
  type ExploreDiagnostic,
  type ExplorePredicate,
  type ExplorePresentation,
  type ExploreQueryContext,
  type ExploreQueryNode,
  type ExploreScalar,
  type ExploreScopePredicate,
  type ExploreSortRule,
  type ExploreTimeComparison,
  type ExploreTimeField,
  type ExploreTimePredicate,
  type ExploreView,
  type HMExploreResultType,
  type ParsedExploreQuery,
} from '@seed-hypermedia/client/explore-query'

/** Context that defines where Explore should search. */
export type HMExploreContext = {type: 'site'; id: UnpackedHypermediaId} | {type: 'node'}
/** A matched field surfaced by an Explore result. */
export type HMExploreMatchedField = {
  kind: 'title' | 'body' | 'comment' | 'attribute' | 'path'
  label: string
  value: string
  attributePath?: string[]
}
/** A document-level Explore result. */
export type HMExploreResultDocument = {
  type: 'document'
  id: UnpackedHypermediaId
  document?: HMDocumentInfo
  matchText?: string
  matchedFields?: HMExploreMatchedField[]
  breadcrumb?: string[]
  versionTime?: string
}
/** A block/body-content Explore result encoded by a Hypermedia ID fragment. */
export type HMExploreResultBlock = {
  type: 'block'
  id: UnpackedHypermediaId
  matchText?: string
  matchedFields?: HMExploreMatchedField[]
  breadcrumb?: string[]
  versionTime?: string
}
/** A comment Explore result addressed by containing document plus comment ID. */
export type HMExploreResultComment = {
  type: 'comment'
  documentId: UnpackedHypermediaId
  commentId: string
  matchText?: string
  matchedFields?: HMExploreMatchedField[]
  breadcrumb?: string[]
  versionTime?: string
}
/**
 * A space-level Explore result. A space is addressed by its root document, so this carries the same
 * shape as a document result and is distinguished only by having no path.
 */
export type HMExploreResultSpace = {
  type: 'space'
  id: UnpackedHypermediaId
  document?: HMDocumentInfo
  matchText?: string
  matchedFields?: HMExploreMatchedField[]
  breadcrumb?: string[]
  versionTime?: string
}
/** A contact Explore result, addressed by the account it describes. */
export type HMExploreResultContact = {
  type: 'contact'
  id: UnpackedHypermediaId
  matchText?: string
  matchedFields?: HMExploreMatchedField[]
  breadcrumb?: string[]
  versionTime?: string
}
/** Any result that can be rendered by Explore. */
export type HMExploreResult =
  | HMExploreResultDocument
  | HMExploreResultBlock
  | HMExploreResultComment
  | HMExploreResultSpace
  | HMExploreResultContact

/** Whether a Hypermedia ID addresses a space rather than a document inside one. */
export function isExploreSpaceId(id: UnpackedHypermediaId) {
  return !id.path?.length
}
/**
 * Kinds Explore can list without a search term. Comments and text blocks are absent because
 * neither can be enumerated. `ListComments` needs a specific target document, and blocks exist
 * only as full-text matches.
 */
export type ExploreBrowseKind = Extract<HMExploreResultType, 'document' | 'space' | 'contact'>
export const BROWSABLE_KINDS: ExploreBrowseKind[] = ['document', 'space', 'contact']
/** A stable, removable projection of one AST leaf. */
export type ExploreChip = {
  id: string
  label: string
  token: string
  kind: 'text' | 'attribute' | 'scope' | 'type' | 'author' | 'time'
  path: number[]
}
type ValuedAttributePredicate = Extract<ExploreAttributePredicate, {value: ExploreScalar}>
/** The compiled document-side query and projections needed by later Explore phases. */
export type ExploreCompilation = Omit<ExploreCompilationJson, 'filter'> & {filter?: DocumentFilter}
/** Compiles the AST while preserving boolean structure and reporting dropped search terms. */
export function compileExploreQuery(parsed: ParsedExploreQuery, context: HMExploreContext): ExploreCompilation {
  const compiled = compileExploreQueryJson(
    parsed,
    context.type === 'site'
      ? {type: 'site', url: packHmId({...context.id, version: null, blockRef: null, blockRange: null, latest: null})}
      : {type: 'node'},
  )
  return {...compiled, filter: compiled.filter ? DocumentFilter.fromJson(compiled.filter as JsonValue) : undefined}
}
function chipLabel(node: ExploreQueryNode): {label: string; token: string; kind: ExploreChip['kind']} | null {
  if (node.kind === 'text')
    return {label: `text ${node.value}`, token: node.phrase ? `"${node.value}"` : node.value, kind: 'text'}
  if (node.kind !== 'predicate') return null
  const predicate = node.predicate
  if (predicate.kind === 'type')
    return {label: `type ${predicate.value}`, token: `type:${predicate.value}`, kind: 'type'}
  // Built-in fields take their spelling from the serializer, so the `$` keywords live in one place.
  if (predicate.kind === 'author')
    return {label: `author ${predicate.value}`, token: serializeExploreQuery(node), kind: 'author'}
  if (predicate.kind === 'time') {
    const label = `${predicate.field} ${predicate.comparison} ${predicate.value}`
    return {label, token: serializeExploreQuery(node), kind: 'time'}
  }
  if (predicate.kind === 'scope') {
    if (predicate.scope === 'space' || predicate.scope === 'url')
      return {label: `In ${predicate.value}`, token: `in:${predicate.value}`, kind: 'scope'}
    const pathPredicate = predicate as Extract<ExploreScopePredicate, {scope: 'path'}>
    return {
      label: `Path ${pathPredicate.value}${pathPredicate.prefix ? '/*' : ''}`,
      token: `path:${pathPredicate.value}${pathPredicate.prefix ? '/*' : ''}`,
      kind: 'scope',
    }
  }
  if (predicate.operator === 'exists' || predicate.operator === 'missing')
    return {
      label: `${predicate.operator} ${predicate.key}`,
      token: `${predicate.operator === 'exists' ? 'has' : 'missing'}:${predicate.key}`,
      kind: 'attribute',
    }
  const valued = predicate as ValuedAttributePredicate
  const operator =
    predicate.operator === 'comparison'
      ? (valued as Extract<ExploreAttributePredicate, {operator: 'comparison'}>).comparison
      : predicate.operator === 'contains'
        ? ':'
        : '^'
  return {
    label: `${valued.key} ${operator} ${String(valued.value)}`,
    token: `${valued.key}${operator}${quoteExploreValue(String(valued.value))}`,
    kind: 'attribute',
  }
}
function walk(
  node: ExploreQueryNode | null,
  visit: (node: ExploreQueryNode, path: number[]) => void,
  path: number[] = [],
) {
  if (!node) return
  visit(node, path)
  if (node.kind === 'and' || node.kind === 'or')
    node.children.forEach((child, index) => walk(child, visit, [...path, index]))
  if (node.kind === 'not') walk(node.child, visit, [...path, 0])
}

/** Projects every removable leaf in an AST to a stable path-keyed chip. */
export function exploreQueryChips(parsed: ParsedExploreQuery | ExploreQueryNode | null): ExploreChip[] {
  const ast = (parsed && 'kind' in parsed ? parsed : parsed?.ast) ?? null
  const result: ExploreChip[] = []
  walk(ast, (node, path) => {
    const projection = chipLabel(node)
    if (projection) result.push({id: path.join('.') || '0', path, ...projection})
  })
  return result
}
function removeAtPath(node: ExploreQueryNode | null, path: number[]): ExploreQueryNode | null {
  if (!node || !path.length) return null
  if (node.kind === 'not') {
    const child = removeAtPath(node.child, path.slice(1))
    return child ? {kind: 'not', child} : null
  }
  if (node.kind !== 'and' && node.kind !== 'or') return node
  const index = path[0]!
  const child = node.children[index]
  if (!child) return node
  const replacement = removeAtPath(child, path.slice(1))
  const children = node.children.slice()
  if (replacement) children[index] = replacement
  else children.splice(index, 1)
  if (!children.length) return null
  if (children.length === 1) return children[0]!
  return {kind: node.kind, children}
}
/** Removes one chip by id and returns a new parsed query with empty groups collapsed. */
export function removeExploreQueryChip(parsed: ParsedExploreQuery, chipId: string): ParsedExploreQuery {
  const chip = exploreQueryChips(parsed).find((candidate) => candidate.id === chipId)
  if (!chip) return parsed
  const next = parseExploreQuery(serializeExploreQuery(removeAtPath(parsed.ast, chip.path), parsed.presentation))
  return {...next, diagnostics: parsed.diagnostics.concat(next.diagnostics)}
}

/** Toggles one serialized predicate in the query while preserving presentation directives. */
export function toggleExplorePredicate(parsed: ParsedExploreQuery, token: string): ParsedExploreQuery {
  const existing = exploreQueryChips(parsed).find((chip) => chip.token === token)
  if (existing) return removeExploreQueryChip(parsed, existing.id)
  const predicate = parseExploreQuery(token).ast
  if (!predicate) return parsed
  const ast =
    parsed.ast?.kind === 'and'
      ? {kind: 'and' as const, children: [...parsed.ast.children, predicate]}
      : parsed.ast
        ? {kind: 'and' as const, children: [parsed.ast, predicate]}
        : predicate
  return {ast, presentation: parsed.presentation, diagnostics: []}
}

/**
 * Replaces every predicate of one chip kind with `tokens`, keeping the rest of the query. A filter
 * dropdown owns its kind outright: applying it states the whole selection, so a previous author or
 * date range is dropped rather than combined with the new one.
 */
export function replaceExploreChips(
  parsed: ParsedExploreQuery,
  kind: ExploreChip['kind'],
  tokens: string[],
): ParsedExploreQuery {
  let next = parsed
  for (let chip = exploreQueryChips(next).find((c) => c.kind === kind); chip; ) {
    next = removeExploreQueryChip(next, chip.id)
    chip = exploreQueryChips(next).find((c) => c.kind === kind)
  }
  for (const token of tokens) next = toggleExplorePredicate(next, token)
  return next
}

/** A date range the Date dropdown can apply. */
export type ExploreDateSelection =
  | {field: ExploreTimeField; preset: 'any' | 'week' | 'month' | 'year'}
  | {field: ExploreTimeField; preset: 'custom'; from?: string; to?: string}

const PRESET_DAYS = {week: 7, month: 30, year: 365} as const

/**
 * The query tokens a date selection stands for. A preset is turned into a fixed start date when it
 * is applied, so the query a reader shares or reloads keeps meaning the same days. `to` is
 * inclusive, matching how the range reads in the menu.
 */
export function exploreDateTokens(selection: ExploreDateSelection, now = Date.now()): string[] {
  const token = (comparison: ExploreTimeComparison, value: string) =>
    serializeExploreQuery({kind: 'predicate', predicate: {kind: 'time', field: selection.field, comparison, value}})
  if (selection.preset === 'any') return []
  if (selection.preset === 'custom') {
    return [
      ...(selection.from ? [token('>=', selection.from)] : []),
      ...(selection.to ? [token('<=', selection.to)] : []),
    ]
  }
  const since = new Date(now - PRESET_DAYS[selection.preset] * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return [token('>=', since)]
}

// Narrows a query to one result type, for the currently selected tab.
export function withExploreTypeFilter(
  parsed: ParsedExploreQuery,
  type: HMExploreResultType | null | undefined,
): ParsedExploreQuery {
  if (!type) return parsed
  const compiled = compileExploreQuery(parsed, {type: 'node'})
  if (compiled.requestedTypes.length || compiled.excludedTypes.length) return parsed
  const predicate: ExploreQueryNode = {kind: 'predicate', predicate: {kind: 'type', value: type}}
  const ast: ExploreQueryNode =
    parsed.ast?.kind === 'and'
      ? {kind: 'and', children: [...parsed.ast.children, predicate]}
      : parsed.ast
        ? {kind: 'and', children: [parsed.ast, predicate]}
        : predicate
  return {ast, presentation: parsed.presentation, diagnostics: parsed.diagnostics}
}

/** Cycles an attribute sort rule through ascending, descending, and inactive states. */
export function cycleExploreSort(sort: ExploreSortRule[], key: string): ExploreSortRule[] {
  const current = sort.find((rule) => rule.key === key)
  if (!current) return [...sort, {key, direction: 'asc'}]
  if (current.direction === 'asc')
    return sort.map((rule) => (rule.key === key ? {...rule, direction: 'desc' as const} : rule))
  return sort.filter((rule) => rule.key !== key)
}

/** Toggles a query-table column while retaining a usable title column. */
export function toggleExploreColumn(columns: string[], key: string): string[] {
  const next = columns.includes(key) ? columns.filter((column) => column !== key) : [...columns, key]
  return next.length ? next : ['title']
}

/** Removes predicate leaves while retaining all free-text leaves and their order. */
export function clearExploreConditions(ast: ExploreQueryNode | null): ExploreQueryNode | null {
  if (!ast) return null
  if (ast.kind === 'text') return ast
  if (ast.kind === 'predicate') return null
  const children = ast.kind === 'not' ? [ast.child] : ast.children
  const retained = children.flatMap((child) => {
    const next = clearExploreConditions(child)
    return next ? [next] : []
  })
  if (!retained.length) return null
  if (retained.length === 1) return retained[0]!
  return ast.kind === 'not' ? {kind: 'and', children: retained} : {...ast, children: retained}
}
/** Converts the existing SearchResultItem shape into a typed Explore result. */
export function searchResultItemToExploreResult(item: SearchResultItem): HMExploreResult | null {
  if (item.type === 'contact')
    return {
      type: 'contact',
      id: item.id,
      matchText: item.title,
      breadcrumb: item.parentNames,
      versionTime: item.versionTime,
    }
  if (item.type === 'comment' && item.commentId)
    return {
      type: 'comment',
      documentId: item.id,
      commentId: item.commentId,
      matchText: item.title,
      breadcrumb: item.parentNames,
      versionTime: item.versionTime,
    }
  if (item.type === 'document' && item.id.blockRef)
    return {
      type: 'block',
      id: item.id,
      matchText: item.title,
      breadcrumb: item.parentNames,
      versionTime: item.versionTime,
    }
  if (item.type === 'document')
    return {
      type: isExploreSpaceId(item.id) ? 'space' : 'document',
      id: item.id,
      matchText: item.title,
      breadcrumb: item.parentNames,
      versionTime: item.versionTime,
    }
  return null
}
/**
 * Converts a document info row into an Explore result.
 * Path-less rows surface as spaces.
 */
export function documentInfoToExploreResultDocument(
  document: HMDocumentInfo,
  matchedFields?: HMExploreMatchedField[],
): HMExploreResultDocument | HMExploreResultSpace {
  return {
    type: isExploreSpaceId(document.id) ? 'space' : 'document',
    id: document.id,
    document,
    matchedFields,
    breadcrumb: document.breadcrumbs?.map((breadcrumb) => breadcrumb.name).filter(Boolean),
    versionTime: typeof document.updateTime === 'string' ? document.updateTime : undefined,
  }
}
