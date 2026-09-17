// The Explore query grammar — one string that says which documents you mean — and its compiler to
// the daemon's `DocumentFilter` (in protobuf JSON form, the shape `QueryDocuments` takes over the
// web API). Shared by the app's Explore surface, the CLI's `query --where`, and the agent's `query`
// tool, so every surface understands exactly the same language:
//
//   key:value  key="two words"  key!=value  key>=3  key<10     attribute comparison (typed)
//   key~text (contains)  key^text (starts with)                string match
//   has:key  missing:key                                        presence
//   in:<space uid | hm:// url>  path:/specs  path:/specs/*      scope
//   type:document|block|comment|space|contact                   result type (Explore only)
//   AND  OR  NOT  ( … )   adjacency is AND                      boolean structure
//   free words and "quoted phrases"                             full-text terms (Explore only)
//   view:table  cols:title,status  sort:status,-priority        presentation directives
//
// Parsing is forgiving: problems become diagnostics, never throws, and serialization round-trips.
import type {HMDocumentFilter, HMDocumentFilterComparisonOperator} from './hm-types'

export type ExploreScalar = string | number | boolean
/** The result types the Explore surface can show; `type:` predicates name one. */
export type HMExploreResultType = 'document' | 'block' | 'comment' | 'space' | 'contact'
/** Attribute predicates in the Explore query AST. */
export type ExploreAttributePredicate =
  | {
      kind: 'attribute'
      key: string
      operator: 'comparison'
      comparison: ExploreComparisonOperator
      value: ExploreScalar
    }
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
/** A recoverable parser diagnostic. */
export type ExploreDiagnostic = {message: string; start: number; end: number; severity: 'warning' | 'error'}
/** The parsed query and its presentation directives. */
export type ParsedExploreQuery = {
  ast: ExploreQueryNode | null
  presentation: ExplorePresentation
  diagnostics: ExploreDiagnostic[]
}
export type ExploreComparisonOperator = '=' | '!=' | '<' | '<=' | '>' | '>='
/** Where a query runs: the whole node, or one site (a document subtree, by its canonical `hm://` URL). */
export type ExploreQueryContext = {type: 'node'} | {type: 'site'; url: string}

type Token = {kind: 'word' | 'quoted' | 'operator' | 'lparen' | 'rparen'; value: string; start: number; end: number}
const resultTypes = new Set<HMExploreResultType>(['document', 'block', 'comment', 'space', 'contact'])
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

/** Quotes a value for the grammar when it contains whitespace, parentheses, quotes, or operators. */
export function quoteExploreValue(value: string): string {
  return /[\s()"=<>~^]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value
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
          comparison: operator.value as ExploreComparisonOperator,
          value: parseScalar(value),
        },
      }
    }
    return {kind: 'text', value: `${token.value}${operator.value}${value}`, phrase: false}
  }
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
  if (predicate.operator === 'contains') return `${predicate.key}:${quoteExploreValue(predicate.value)}`
  if (predicate.operator === 'prefix') return `${predicate.key}^${quoteExploreValue(predicate.value)}`
  const comparison = predicate as Extract<ExploreAttributePredicate, {operator: 'comparison'}>
  return `${comparison.key}${comparison.comparison}${
    typeof comparison.value === 'string' ? quoteExploreValue(comparison.value) : String(comparison.value)
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

// ── Compilation to a DocumentFilter (protobuf JSON) ─────────────────────────────────────────────

function attributeValueJson(value: ExploreScalar): NonNullable<HMDocumentFilter['comparison']>['value'] {
  return typeof value === 'number'
    ? {intValue: value}
    : typeof value === 'boolean'
      ? {boolValue: value}
      : {stringValue: value}
}
function comparisonOperatorJson(operator: ExploreComparisonOperator): HMDocumentFilterComparisonOperator {
  switch (operator) {
    case '!=':
      return 'NOT_EQUAL'
    case '<':
      return 'LESS_THAN'
    case '<=':
      return 'LESS_THAN_OR_EQUAL'
    case '>':
      return 'GREATER_THAN'
    case '>=':
      return 'GREATER_THAN_OR_EQUAL'
    default:
      return 'EQUAL'
  }
}
function predicateFilter(predicate: ExplorePredicate): HMDocumentFilter | undefined {
  if (predicate.kind === 'type') return undefined
  if (predicate.kind === 'scope') {
    if (predicate.scope === 'space') return {spaceMatch: {space: predicate.value}}
    if (predicate.scope === 'url') return {urlMatch: {url: predicate.value, prefix: true}}
    const pathPredicate = predicate as Extract<ExploreScopePredicate, {scope: 'path'}>
    return {pathMatch: {path: pathPredicate.value === '/' ? '' : pathPredicate.value, prefix: pathPredicate.prefix}}
  }
  if (predicate.operator === 'exists') return {exists: {key: predicate.key}}
  if (predicate.operator === 'missing') return {missing: {key: predicate.key}}
  if (predicate.operator === 'contains' || predicate.operator === 'prefix') {
    return {
      stringMatch: {
        key: predicate.key,
        value: predicate.value,
        caseSensitive: false,
        prefix: predicate.operator === 'prefix',
      },
    }
  }
  const comparison = predicate as Extract<ExploreAttributePredicate, {operator: 'comparison'}>
  return {
    comparison: {
      key: comparison.key,
      operator: comparisonOperatorJson(comparison.comparison),
      value: attributeValueJson(comparison.value),
    },
  }
}
type CompiledNode = {filter?: HMDocumentFilter; unconstrained: boolean}

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
      ? {filter: {not: {filter: child.filter}}, unconstrained: false}
      : {unconstrained: true}
  }
  const children = node.children.map(compileNode)
  if (node.kind === 'or' && children.some((child) => child.unconstrained)) return {unconstrained: true}
  const filters = children.flatMap((child) => (child.filter ? [child.filter] : []))
  if (!filters.length) return {unconstrained: true}
  if (filters.length === 1) return {filter: filters[0], unconstrained: children.some((child) => child.unconstrained)}
  return {
    filter: node.kind === 'and' ? {and: {filters}} : {or: {filters}},
    unconstrained: children.some((child) => child.unconstrained),
  }
}
function contextFilter(context: ExploreQueryContext): HMDocumentFilter | null {
  if (context.type !== 'site') return null
  return {urlMatch: {url: context.url, prefix: true}}
}

/** The compiled document-side query and the projections the Explore surface needs. */
export type ExploreCompilation = {
  /** The `DocumentFilter` for `QueryDocuments`, in protobuf JSON; undefined when nothing constrains documents. */
  filter?: HMDocumentFilter
  documentPredicates: ExplorePredicate[]
  textTerms: Array<{value: string; phrase: boolean}>
  requestedTypes: HMExploreResultType[]
  excludedTypes: HMExploreResultType[]
  positiveScopes: Array<Extract<ExplorePredicate, {kind: 'scope'}>>
  presentation: ExplorePresentation
  diagnostics: ExploreDiagnostic[]
}
/** Compiles the AST while preserving boolean structure and reporting dropped search terms. */
export function compileExploreQuery(parsed: ParsedExploreQuery, context: ExploreQueryContext): ExploreCompilation {
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
  const filters = [contextFilter(context), compiled.filter].filter((filter): filter is HMDocumentFilter => !!filter)
  const filter = filters.length === 0 ? undefined : filters.length === 1 ? filters[0] : {and: {filters}}
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
