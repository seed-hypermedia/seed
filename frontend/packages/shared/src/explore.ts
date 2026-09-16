import type {JsonValue} from '@bufbuild/protobuf'
import type {HMDocumentInfo, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {
  compileExploreQuery as compileExploreQueryJson,
  parseExploreQuery,
  quoteExploreValue,
  serializeExploreQuery,
  type ExploreAttributePredicate,
  type ExploreCompilation as ExploreCompilationJson,
  type ExploreQueryNode,
  type ExploreScopePredicate,
  type ExploreScalar,
  type ExploreSortRule,
  type ParsedExploreQuery,
} from '@seed-hypermedia/client/explore-query'
import {DocumentFilter} from './client/grpc-types'
import type {SearchResultItem} from './models/search'
import {packHmId} from './utils/entity-id-url'

// The grammar, parser, serializer, and JSON compiler live in the client SDK
// (`@seed-hypermedia/client/explore-query`) so the CLI and the agents service speak the same
// language; this module keeps the app-facing pieces — result models, chips, and the compiler
// wrapper that yields protobuf message instances.
export {
  parseExploreQuery,
  serializeExploreQuery,
  quoteExploreValue,
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
/** Scalar values accepted by document attribute comparisons. */
/** A stable, removable projection of one AST leaf. */
export type ExploreChip = {
  id: string
  label: string
  token: string
  kind: 'text' | 'attribute' | 'scope' | 'type'
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
