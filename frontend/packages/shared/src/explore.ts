import type {HMDocumentInfo, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {
  AttributeValue,
  DocumentFilter,
  DocumentFilter_And,
  DocumentFilter_Comparison,
  DocumentFilter_Comparison_Operator,
  DocumentFilter_Not,
  DocumentFilter_Or,
  DocumentFilter_PathMatch,
  DocumentFilter_Presence,
  DocumentFilter_SpaceMatch,
  DocumentFilter_StringMatch,
  DocumentFilter_URLMatch,
} from './client/grpc-types'
import type {SearchResultItem} from './models/search'
import {packHmId} from './utils/entity-id-url'

/** Context that defines where Explore should search. */
export type HMExploreContext = {type: 'site'; id: UnpackedHypermediaId} | {type: 'node'}
/** Supported result type filters in the Explore query string. */
export type HMExploreResultType = 'document' | 'block' | 'comment'
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
/** Any result that can be rendered by Explore. */
export type HMExploreResult = HMExploreResultDocument | HMExploreResultBlock | HMExploreResultComment
/** Scalar values accepted by document attribute comparisons. */
export type ExploreScalar = string | number | boolean
/** Attribute predicates in the Explore query AST. */
export type ExploreAttributePredicate =
  | {kind: 'attribute'; key: string; operator: 'comparison'; comparison: ComparisonOperator; value: ExploreScalar}
  | {kind: 'attribute'; key: string; operator: 'contains' | 'prefix'; value: string}
  | {kind: 'attribute'; key: string; operator: 'exists' | 'missing'}
/** Scope predicates in the Explore query AST. */
export type ExploreScopePredicate =
  | {kind: 'scope'; scope: 'space' | 'url'; value: string}
  | {kind: 'scope'; scope: 'path'; value: string; prefix: boolean}
/** Leaf predicates in the Explore query AST. */
export type ExplorePredicate =
  | ExploreAttributePredicate
  | ExploreScopePredicate
  | {kind: 'type'; value: HMExploreResultType}
/** Boolean Explore query AST. */
export type ExploreQueryNode =
  | {kind: 'text'; value: string; phrase: boolean}
  | {kind: 'predicate'; predicate: ExplorePredicate}
  | {kind: 'and' | 'or'; children: ExploreQueryNode[]}
  | {kind: 'not'; child: ExploreQueryNode}
/** A multi-key document sort directive. */
export type ExploreSortRule = {key: string; direction: 'asc' | 'desc'}
/** Presentation directives kept separate from the boolean query tree. */
export type ExplorePresentation = {view?: 'list' | 'table'; columns?: string[]; sort?: ExploreSortRule[]}
/** Faceted predicate families exposed by the Explore filter bar. */
export type ExploreFacet = 'space' | 'type' | 'path'
/** A recoverable parser diagnostic. */
export type ExploreDiagnostic = {message: string; start: number; end: number; severity: 'warning' | 'error'}
/** A stable, removable projection of one AST leaf. */
export type ExploreChip = {
  id: string
  label: string
  token: string
  kind: 'text' | 'attribute' | 'scope' | 'type'
  path: number[]
}
/** The parsed query and its presentation directives. */
export type ParsedExploreQuery = {
  ast: ExploreQueryNode | null
  presentation: ExplorePresentation
  diagnostics: ExploreDiagnostic[]
}
type ComparisonOperator = '=' | '!=' | '<' | '<=' | '>' | '>='
type ValuedAttributePredicate = Extract<ExploreAttributePredicate, {value: ExploreScalar}>
type Token = {kind: 'word' | 'quoted' | 'operator' | 'lparen' | 'rparen'; value: string; start: number; end: number}
const resultTypes = new Set<HMExploreResultType>(['document', 'block', 'comment'])
const comparisonOperators = new Set(['=', '!=', '<', '<=', '>', '>='])

function diagnostic(
  message: string,
  start: number,
  end: number,
  severity: ExploreDiagnostic['severity'] = 'warning',
): ExploreDiagnostic {
  return {message, start, end, severity}
}

function extractPresentation(query: string, tokens: Token[], diagnostics: ExploreDiagnostic[]) {
  const presentation: ExplorePresentation = {}
  const ranges: Array<[number, number]> = []
  for (let index = 0; index < tokens.length - 2; index++) {
    const nameToken = tokens[index]
    const operatorToken = tokens[index + 1]
    const valueToken = tokens[index + 2]
    if (nameToken?.kind !== 'word' || !['view', 'cols', 'sort'].includes(nameToken.value.toLowerCase())) continue
    if (operatorToken?.kind !== 'operator' || operatorToken.value !== ':') continue
    if (valueToken?.kind !== 'word' && valueToken?.kind !== 'quoted') continue
    const name = nameToken.value.toLowerCase()
    const value = valueToken.value
    ranges.push([nameToken.start, valueToken.end])
    if (name === 'view') {
      if (value === 'list' || value === 'table') presentation.view = value
      else diagnostics.push(diagnostic(`Unknown view "${value}".`, nameToken.start, valueToken.end))
    } else if (name === 'cols') {
      const columns = value
        .split(',')
        .map((column) => column.trim())
        .filter(Boolean)
      if (columns.length) presentation.columns = columns
      else
        diagnostics.push(diagnostic('The cols directive needs at least one column.', nameToken.start, valueToken.end))
    } else {
      const sort = value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map(
          (item) =>
            ({
              key: item.startsWith('-') ? item.slice(1) : item,
              direction: item.startsWith('-') ? 'desc' : 'asc',
            }) as ExploreSortRule,
        )
        .filter((item) => item.key)
      if (sort.length) presentation.sort = sort
      else diagnostics.push(diagnostic('The sort directive needs at least one key.', nameToken.start, valueToken.end))
    }
    index += 2
  }
  let result = ''
  let cursor = 0
  for (const [start, end] of ranges) {
    result += query.slice(cursor, start)
    cursor = end
  }
  return {query: result + query.slice(cursor), presentation}
}

function tokenize(query: string, diagnostics: ExploreDiagnostic[]): Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < query.length) {
    if (/\s/.test(query[index]!)) {
      index++
      continue
    }
    const start = index
    const char = query[index]
    if (char === '(' || char === ')') {
      tokens.push({kind: char === '(' ? 'lparen' : 'rparen', value: char, start, end: ++index})
      continue
    }
    if (char === '"') {
      index++
      let value = ''
      let closed = false
      while (index < query.length) {
        const current = query[index++]
        if (current === '\\' && index < query.length) value += query[index++]
        else if (current === '"') {
          closed = true
          break
        } else value += current
      }
      if (!closed) diagnostics.push(diagnostic('Unterminated quoted phrase.', start, index))
      tokens.push({kind: 'quoted', value, start, end: index})
      continue
    }
    if (query.startsWith('!=', index) || query.startsWith('>=', index) || query.startsWith('<=', index)) {
      tokens.push({kind: 'operator', value: query.slice(index, index + 2), start, end: (index += 2)})
      continue
    }
    if ('=<>~^'.includes(char!)) {
      tokens.push({kind: 'operator', value: char!, start, end: ++index})
      continue
    }
    if (char === ':') {
      tokens.push({kind: 'operator', value: char, start, end: ++index})
      continue
    }
    const valueToken = tokens[tokens.length - 1]?.kind === 'operator'
    while (
      index < query.length &&
      !/\s/.test(query[index]!) &&
      !'()=<>~^'.includes(query[index]!) &&
      !(query[index] === '!' && query[index + 1] === '=') &&
      !(query[index] === ':' && !valueToken)
    ) {
      index++
    }
    tokens.push({kind: 'word', value: query.slice(start, index), start, end: index})
  }
  return tokens
}

function parseScalar(value: string): ExploreScalar {
  if (/^-?\d+$/.test(value)) return Number(value)
  if (value === 'true') return true
  if (value === 'false') return false
  return value
}

function quoteValue(value: string): string {
  const needsQuotes = value.length === 0 || /[\s()"=<>~^]/.test(value) || /^(?:-?\d+|true|false)$/.test(value)
  return needsQuotes ? `"${value.replace(/"/g, '\\"')}"` : value
}

function flatten(kind: 'and' | 'or', children: ExploreQueryNode[]): ExploreQueryNode {
  const flattened = children.flatMap((child) => (child.kind === kind ? child.children : [child]))
  return flattened.length === 1 ? flattened[0]! : {kind, children: flattened}
}

class ExploreParser {
  private index = 0
  constructor(
    private readonly tokens: Token[],
    private readonly diagnostics: ExploreDiagnostic[],
  ) {}
  parse(): ExploreQueryNode | null {
    const node = this.parseOr()
    while (this.current()) {
      const token = this.current()!
      this.diagnostics.push(diagnostic(`Unexpected token "${token.value}".`, token.start, token.end))
      this.index++
    }
    return node
  }
  private current() {
    return this.tokens[this.index]
  }
  private parseOr(): ExploreQueryNode | null {
    const nodes: ExploreQueryNode[] = []
    const first = this.parseAnd()
    if (first) nodes.push(first)
    while (this.current()?.kind === 'word' && this.current()?.value.toUpperCase() === 'OR') {
      const token = this.current()!
      this.index++
      const next = this.parseAnd()
      if (next) nodes.push(next)
      else this.diagnostics.push(diagnostic('OR needs a right-hand expression.', token.start, token.end))
    }
    return nodes.length ? flatten('or', nodes) : null
  }
  private parseAnd(): ExploreQueryNode | null {
    const nodes: ExploreQueryNode[] = []
    const first = this.parseUnary()
    if (first) nodes.push(first)
    while (true) {
      const token = this.current()
      if (token?.kind === 'word' && token.value.toUpperCase() === 'AND') {
        this.index++
        const next = this.parseUnary()
        if (next) nodes.push(next)
        else this.diagnostics.push(diagnostic('AND needs a right-hand expression.', token.start, token.end))
        continue
      }
      if (
        token &&
        (token.kind === 'lparen' || token.kind === 'quoted' || token.kind === 'word') &&
        token.value.toUpperCase() !== 'OR'
      ) {
        const next = this.parseUnary()
        if (next) nodes.push(next)
        continue
      }
      break
    }
    return nodes.length ? flatten('and', nodes) : null
  }
  private parseUnary(): ExploreQueryNode | null {
    const token = this.current()
    if (token?.kind === 'word' && token.value.toUpperCase() === 'NOT') {
      this.index++
      const child = this.parseUnary()
      if (!child) this.diagnostics.push(diagnostic('NOT needs an expression.', token.start, token.end))
      return child ? {kind: 'not', child} : null
    }
    if (token?.kind === 'operator') {
      this.diagnostics.push(diagnostic(`Unexpected operator "${token.value}".`, token.start, token.end))
      this.index++
      return this.parseUnary()
    }
    return this.parsePrimary()
  }
  private parsePrimary(): ExploreQueryNode | null {
    const token = this.current()
    if (!token) return null
    if (token.kind === 'lparen') {
      this.index++
      const child = this.parseOr()
      if (this.current()?.kind === 'rparen') this.index++
      else this.diagnostics.push(diagnostic('Missing closing parenthesis.', token.start, token.end))
      return child
    }
    if (token.kind === 'rparen') {
      this.diagnostics.push(diagnostic('Unexpected closing parenthesis.', token.start, token.end))
      this.index++
      return null
    }
    this.index++
    if (token.kind === 'quoted') return {kind: 'text', value: token.value, phrase: true}
    const operator = this.current()
    if (operator?.kind !== 'operator') return {kind: 'text', value: token.value, phrase: false}
    this.index++
    const valueToken = this.current()
    if (!valueToken || valueToken.kind === 'rparen' || valueToken.kind === 'operator') {
      this.diagnostics.push(
        diagnostic(`Predicate "${token.value}${operator.value}" needs a value.`, token.start, operator.end),
      )
      return {kind: 'text', value: token.value, phrase: false}
    }
    this.index++
    const value = valueToken.value
    if (operator.value === ':' && token.value === 'type') {
      if (resultTypes.has(value as HMExploreResultType))
        return {kind: 'predicate', predicate: {kind: 'type', value: value as HMExploreResultType}}
      return {kind: 'predicate', predicate: {kind: 'attribute', key: token.value, operator: 'contains', value}}
    }
    if (operator.value === ':' && token.value === 'in') {
      if (value === 'site' || value === 'node') return null
      return {
        kind: 'predicate',
        predicate: value.startsWith('hm://')
          ? {kind: 'scope', scope: 'url', value}
          : {kind: 'scope', scope: 'space', value},
      }
    }
    if (operator.value === ':' && token.value === 'path') {
      const prefix = value.endsWith('/*')
      return {
        kind: 'predicate',
        predicate: {kind: 'scope', scope: 'path', value: prefix ? value.slice(0, -2) : value, prefix},
      }
    }
    if ((token.value === 'has' || token.value === 'missing') && operator.value === ':') {
      return {
        kind: 'predicate',
        predicate: {kind: 'attribute', key: value, operator: token.value === 'has' ? 'exists' : 'missing'},
      }
    }
    if (operator.value === ':' || operator.value === '~' || operator.value === '^') {
      return {
        kind: 'predicate',
        predicate: {
          kind: 'attribute',
          key: token.value,
          operator: operator.value === '^' ? 'prefix' : 'contains',
          value: valueToken.kind === 'quoted' ? value : String(parseScalar(value)),
        },
      }
    }
    if (comparisonOperators.has(operator.value)) {
      return {
        kind: 'predicate',
        predicate: {
          kind: 'attribute',
          key: token.value,
          operator: 'comparison',
          comparison: operator.value as ComparisonOperator,
          value: valueToken.kind === 'quoted' ? value : parseScalar(value),
        },
      }
    }
    return {kind: 'text', value: `${token.value}${operator.value}${value}`, phrase: false}
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

/** Parses an Explore query into a forgiving boolean AST and presentation directives. */
export function parseExploreQuery(query: string): ParsedExploreQuery {
  const diagnostics: ExploreDiagnostic[] = []
  const source = query
  const sourceTokens = tokenize(source, diagnostics)
  const {query: withoutPresentation, presentation} = extractPresentation(source, sourceTokens, diagnostics)
  const ast = new ExploreParser(tokenize(withoutPresentation, diagnostics), diagnostics).parse()
  return {ast, presentation, diagnostics}
}

function nodePrecedence(node: ExploreQueryNode) {
  return node.kind === 'or' ? 1 : node.kind === 'and' ? 2 : node.kind === 'not' ? 3 : 4
}

function serializePredicate(predicate: ExplorePredicate): string {
  if (predicate.kind === 'type') return `type:${predicate.value}`
  if (predicate.kind === 'scope') {
    if (predicate.scope === 'space' || predicate.scope === 'url') return `in:${predicate.value}`
    const pathPredicate = predicate as Extract<ExploreScopePredicate, {scope: 'path'}>
    return `path:${pathPredicate.value}${pathPredicate.prefix ? '/*' : ''}`
  }
  if (predicate.operator === 'exists' || predicate.operator === 'missing')
    return `${predicate.operator === 'exists' ? 'has' : 'missing'}:${predicate.key}`
  if (predicate.operator === 'contains') return `${predicate.key}:${quoteValue(predicate.value)}`
  if (predicate.operator === 'prefix') return `${predicate.key}^${quoteValue(predicate.value)}`
  const comparison = predicate as Extract<ExploreAttributePredicate, {operator: 'comparison'}>
  return `${comparison.key}${comparison.comparison}${
    typeof comparison.value === 'string' ? quoteValue(comparison.value) : String(comparison.value)
  }`
}

function serializeNode(node: ExploreQueryNode, parentPrecedence = 0): string {
  let value: string
  if (node.kind === 'text') value = node.phrase ? `"${node.value.replace(/"/g, '\\"')}"` : node.value
  else if (node.kind === 'predicate') value = serializePredicate(node.predicate)
  else if (node.kind === 'not') value = `NOT ${serializeNode(node.child, nodePrecedence(node))}`
  else
    value = node.children
      .map((child) => serializeNode(child, nodePrecedence(node)))
      .join(node.kind === 'and' ? ' AND ' : ' OR ')
  return nodePrecedence(node) < parentPrecedence ? `(${value})` : value
}

/** Serializes a parsed query's AST and presentation directives into a stable q string. */
export function serializeExploreQuery(
  query: ParsedExploreQuery | ExploreQueryNode | null,
  presentation?: ExplorePresentation,
): string {
  const ast = query && 'kind' in query ? query : query?.ast
  const directives = query && 'kind' in query ? presentation : query?.presentation
  const parts = ast ? [serializeNode(ast)] : []
  if (directives?.view) parts.push(`view:${directives.view}`)
  if (directives?.columns?.length) parts.push(`cols:${directives.columns.join(',')}`)
  if (directives?.sort?.length)
    parts.push(`sort:${directives.sort.map((rule) => `${rule.direction === 'desc' ? '-' : ''}${rule.key}`).join(',')}`)
  return parts.join(' ')
}

function isFacetPredicate(node: ExploreQueryNode, facet: ExploreFacet): boolean {
  if (node.kind !== 'predicate') return false
  return facet === 'type'
    ? node.predicate.kind === 'type'
    : node.predicate.kind === 'scope' &&
        (facet === 'space' ? node.predicate.scope === 'space' : node.predicate.scope === 'path')
}

/** Returns the currently selected positive values for an Explore facet. */
export function exploreFacetValues(parsed: ParsedExploreQuery, facet: ExploreFacet): string[] {
  const values: string[] = []
  const visit = (node: ExploreQueryNode | null, positive = true) => {
    if (!node) return
    if (node.kind === 'predicate' && positive && isFacetPredicate(node, facet)) {
      const predicate = node.predicate
      if (predicate.kind === 'type' || (predicate.kind === 'scope' && predicate.scope === 'space')) {
        values.push(predicate.value)
      } else if (predicate.kind === 'scope' && predicate.scope === 'path') {
        values.push(`${predicate.value}${predicate.prefix ? '/*' : ''}`)
      }
      return
    }
    if (node.kind === 'not') return visit(node.child, !positive)
    if (node.kind === 'and' || node.kind === 'or') node.children.forEach((child) => visit(child, positive))
  }
  visit(parsed.ast)
  return Array.from(new Set(values))
}

/** Replaces one positive facet family while preserving text and other predicates. */
export function replaceExploreFacet(
  parsed: ParsedExploreQuery,
  facet: ExploreFacet,
  values: string[],
): ParsedExploreQuery {
  const selected = Array.from(new Set(values.filter(Boolean)))
  const facetValues = facet === 'path' ? selected.slice(0, 1) : selected
  const remove = (node: ExploreQueryNode | null, positive = true): ExploreQueryNode | null => {
    if (!node) return null
    if (positive && isFacetPredicate(node, facet)) return null
    if (node.kind === 'not') {
      const child = remove(node.child, !positive)
      return child ? {kind: 'not', child} : null
    }
    if (node.kind !== 'and' && node.kind !== 'or') return node
    const children = node.children.flatMap((child) => {
      const next = remove(child, positive)
      return next ? [next] : []
    })
    if (!children.length) return null
    if (children.length === 1) return children[0]!
    return {...node, children}
  }
  const facetNode = facetValues.length
    ? facetValues.length === 1
      ? {
          kind: 'predicate' as const,
          predicate:
            facet === 'type'
              ? {kind: 'type' as const, value: facetValues[0] as HMExploreResultType}
              : facet === 'space'
                ? {kind: 'scope' as const, scope: 'space' as const, value: facetValues[0]!}
                : {
                    kind: 'scope' as const,
                    scope: 'path' as const,
                    value: facetValues[0]!.endsWith('/*') ? facetValues[0]!.slice(0, -2) : facetValues[0]!,
                    prefix: facetValues[0]!.endsWith('/*'),
                  },
        }
      : {
          kind: 'or' as const,
          children: facetValues.map((value) => ({
            kind: 'predicate' as const,
            predicate:
              facet === 'type'
                ? {kind: 'type' as const, value: value as HMExploreResultType}
                : {kind: 'scope' as const, scope: 'space' as const, value},
          })),
        }
    : null
  const remaining = remove(parsed.ast)
  const ast = facetNode ? (remaining ? {kind: 'and' as const, children: [remaining, facetNode]} : facetNode) : remaining
  return {...parsed, ast}
}

function attributeValue(value: ExploreScalar) {
  return new AttributeValue({
    value:
      typeof value === 'number'
        ? {case: 'intValue', value: BigInt(value)}
        : typeof value === 'boolean'
          ? {case: 'boolValue', value}
          : {case: 'stringValue', value},
  })
}
function comparisonOperator(operator: ComparisonOperator) {
  switch (operator) {
    case '!=':
      return DocumentFilter_Comparison_Operator.NOT_EQUAL
    case '<':
      return DocumentFilter_Comparison_Operator.LESS_THAN
    case '<=':
      return DocumentFilter_Comparison_Operator.LESS_THAN_OR_EQUAL
    case '>':
      return DocumentFilter_Comparison_Operator.GREATER_THAN
    case '>=':
      return DocumentFilter_Comparison_Operator.GREATER_THAN_OR_EQUAL
    default:
      return DocumentFilter_Comparison_Operator.EQUAL
  }
}
function predicateFilter(predicate: ExplorePredicate): DocumentFilter | undefined {
  if (predicate.kind === 'type') return undefined
  if (predicate.kind === 'scope') {
    if (predicate.scope === 'space')
      return new DocumentFilter({
        filter: {case: 'spaceMatch', value: new DocumentFilter_SpaceMatch({space: predicate.value})},
      })
    if (predicate.scope === 'url')
      return new DocumentFilter({
        filter: {case: 'urlMatch', value: new DocumentFilter_URLMatch({url: predicate.value, prefix: true})},
      })
    const pathPredicate = predicate as Extract<ExploreScopePredicate, {scope: 'path'}>
    return new DocumentFilter({
      filter: {
        case: 'pathMatch',
        value: new DocumentFilter_PathMatch({
          path: pathPredicate.value === '/' ? '' : pathPredicate.value,
          prefix: pathPredicate.prefix,
        }),
      },
    })
  }
  if (predicate.operator === 'exists' || predicate.operator === 'missing')
    return new DocumentFilter({
      filter: {case: predicate.operator, value: new DocumentFilter_Presence({key: predicate.key})},
    })
  if (predicate.operator === 'contains' || predicate.operator === 'prefix') {
    return new DocumentFilter({
      filter: {
        case: 'stringMatch',
        value: new DocumentFilter_StringMatch({
          key: predicate.key,
          value: predicate.value,
          caseSensitive: false,
          prefix: predicate.operator === 'prefix',
        }),
      },
    })
  }
  const comparison = predicate as Extract<ExploreAttributePredicate, {operator: 'comparison'}>
  return new DocumentFilter({
    filter: {
      case: 'comparison',
      value: new DocumentFilter_Comparison({
        key: comparison.key,
        operator: comparisonOperator(comparison.comparison),
        value: attributeValue(comparison.value),
      }),
    },
  })
}
type CompiledNode = {filter?: DocumentFilter; unconstrained: boolean}

function compileNode(node: ExploreQueryNode | null): CompiledNode {
  if (!node || node.kind === 'text' || (node.kind === 'predicate' && node.predicate.kind === 'type'))
    return {unconstrained: true}
  if (node.kind === 'predicate') {
    const filter = predicateFilter(node.predicate)
    return filter ? {filter, unconstrained: false} : {unconstrained: true}
  }
  if (node.kind === 'not') {
    const child = compileNode(node.child)
    return child.filter && !child.unconstrained
      ? {
          filter: new DocumentFilter({filter: {case: 'not', value: new DocumentFilter_Not({filter: child.filter})}}),
          unconstrained: false,
        }
      : {unconstrained: true}
  }
  const children = node.children.map(compileNode)
  if (node.kind === 'or' && children.some((child) => child.unconstrained)) return {unconstrained: true}
  const filters = children.flatMap((child) => (child.filter ? [child.filter] : []))
  if (!filters.length) return {unconstrained: true}
  if (filters.length === 1) return {filter: filters[0], unconstrained: children.some((child) => child.unconstrained)}
  return {
    filter: new DocumentFilter({
      filter: {
        case: node.kind,
        value: node.kind === 'and' ? new DocumentFilter_And({filters}) : new DocumentFilter_Or({filters}),
      },
    }),
    unconstrained: children.some((child) => child.unconstrained),
  }
}
function contextFilter(context: HMExploreContext): DocumentFilter | null {
  if (context.type !== 'site') return null
  const url = packHmId({...context.id, version: null, blockRef: null, blockRange: null, latest: null})
  return new DocumentFilter({filter: {case: 'urlMatch', value: new DocumentFilter_URLMatch({url, prefix: true})}})
}

/** The compiled document-side query and projections needed by later Explore phases. */
export type ExploreCompilation = {
  filter?: DocumentFilter
  documentPredicates: ExplorePredicate[]
  textTerms: Array<{value: string; phrase: boolean}>
  requestedTypes: HMExploreResultType[]
  excludedTypes: HMExploreResultType[]
  positiveScopes: Array<Extract<ExplorePredicate, {kind: 'scope'}>>
  presentation: ExplorePresentation
  diagnostics: ExploreDiagnostic[]
}
/** Compiles the AST while preserving boolean structure and reporting dropped search terms. */
export function compileExploreQuery(parsed: ParsedExploreQuery, context: HMExploreContext): ExploreCompilation {
  const documentPredicates: ExplorePredicate[] = []
  const textTerms: Array<{value: string; phrase: boolean}> = []
  const requestedTypes: HMExploreResultType[] = []
  const excludedTypes: HMExploreResultType[] = []
  const positiveScopes: Array<Extract<ExplorePredicate, {kind: 'scope'}>> = []
  const diagnostics: ExploreDiagnostic[] = []
  const containsText = (node: ExploreQueryNode | null): boolean => {
    if (!node) return false
    if (node.kind === 'text') return true
    if (node.kind === 'not') return containsText(node.child)
    if (node.kind === 'and' || node.kind === 'or') return node.children.some(containsText)
    return false
  }
  const containsPredicate = (node: ExploreQueryNode | null): boolean => {
    if (!node) return false
    if (node.kind === 'predicate') return true
    if (node.kind === 'not') return containsPredicate(node.child)
    if (node.kind === 'and' || node.kind === 'or') return node.children.some(containsPredicate)
    return false
  }
  const walkWithPolarity = (node: ExploreQueryNode | null, positive = true) => {
    if (!node) return
    if (node.kind === 'text') textTerms.push({value: node.value, phrase: node.phrase})
    if (node.kind === 'predicate') {
      if (node.predicate.kind === 'type') {
        if (positive) requestedTypes.push(node.predicate.value)
        else excludedTypes.push(node.predicate.value)
      } else {
        documentPredicates.push(node.predicate)
        if (positive && node.predicate.kind === 'scope') positiveScopes.push(node.predicate)
      }
      return
    }
    if (node.kind === 'not') {
      const child = compileNode(node.child)
      if (positive && child.unconstrained && containsText(node.child) && containsPredicate(node.child)) {
        diagnostics.push(
          diagnostic(
            'This exclusion could not be applied to the text part; results may include excluded documents.',
            0,
            0,
          ),
        )
      }
      return walkWithPolarity(node.child, !positive)
    }
    if (node.kind === 'and' || node.kind === 'or') node.children.forEach((child) => walkWithPolarity(child, positive))
  }
  walkWithPolarity(parsed.ast)
  const compiled = compileNode(parsed.ast)
  const filters = [contextFilter(context), compiled.filter].filter((filter): filter is DocumentFilter => !!filter)
  const filter =
    filters.length === 0
      ? undefined
      : filters.length === 1
        ? filters[0]
        : new DocumentFilter({filter: {case: 'and', value: new DocumentFilter_And({filters})}})
  return {
    filter,
    documentPredicates,
    textTerms,
    requestedTypes: Array.from(new Set(requestedTypes)),
    excludedTypes: Array.from(new Set(excludedTypes)),
    positiveScopes,
    presentation: parsed.presentation,
    diagnostics,
  }
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
    token: `${valued.key}${operator}${quoteValue(String(valued.value))}`,
    kind: 'attribute',
  }
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
  if (item.type === 'contact') return null
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
      type: 'document',
      id: item.id,
      matchText: item.title,
      breadcrumb: item.parentNames,
      versionTime: item.versionTime,
    }
  return null
}
/** Converts a document info row into an Explore document result. */
export function documentInfoToExploreResultDocument(
  document: HMDocumentInfo,
  matchedFields?: HMExploreMatchedField[],
): HMExploreResultDocument {
  return {
    type: 'document',
    id: document.id,
    document,
    matchedFields,
    breadcrumb: document.breadcrumbs?.map((breadcrumb) => breadcrumb.name).filter(Boolean),
    versionTime: typeof document.updateTime === 'string' ? document.updateTime : undefined,
  }
}
