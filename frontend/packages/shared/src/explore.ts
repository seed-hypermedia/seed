import type {HMDocumentInfo, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {
  AttributeValue,
  DocumentFilter,
  DocumentFilter_And,
  DocumentFilter_Comparison,
  DocumentFilter_Comparison_Operator,
  DocumentFilter_Presence,
  DocumentFilter_StringMatch,
  DocumentFilter_URLMatch,
} from './client/grpc-types'
import type {SearchResultItem} from './models/search'
import {packHmId} from './utils/entity-id-url'

/** Context that defines where Explore should search. */
export type HMExploreContext = {type: 'site'; id: UnpackedHypermediaId} | {type: 'node'}

/** Supported result type filters in the Explore query string. */
export type HMExploreResultType = 'document' | 'block' | 'comment'

/** Sort options supported by the Explore prototype. */
export type HMExploreSort = 'relevance' | 'recently_updated' | 'newest' | 'oldest' | 'title'

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

/** Parsed attribute filter from the Explore query string. */
export type ParsedExploreAttributeFilter =
  | {key: string; operator: 'exists' | 'missing'}
  | {key: string; operator: 'contains' | '=' | '!=' | '<' | '<=' | '>' | '>='; value: string | number | boolean}

type ParsedExploreValuedAttributeFilter = Extract<ParsedExploreAttributeFilter, {value: string | number | boolean}>

/** Parsed representation of an Explore query string. */
export type ParsedExploreQuery = {
  text: string
  terms: string[]
  phrases: string[]
  types: HMExploreResultType[]
  context?: HMExploreContext['type']
  attributes: ParsedExploreAttributeFilter[]
}

const typeValues = new Set<HMExploreResultType>(['document', 'block', 'comment'])

function tokenizeExploreQuery(query: string): string[] {
  const tokens: string[] = []
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(query))) {
    const token = match[1] !== undefined ? `"${match[1].replace(/\\"/g, '"')}"` : match[2]
    if (token) tokens.push(token)
  }
  return tokens
}

function unquote(value: string) {
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1).replace(/\\"/g, '"')
  return value
}

function parseScalar(value: string): string | number | boolean {
  const unquoted = unquote(value)
  if (/^-?\d+$/.test(unquoted)) return Number(unquoted)
  if (unquoted === 'true') return true
  if (unquoted === 'false') return false
  return unquoted
}

function parseAttributeToken(token: string): ParsedExploreAttributeFilter | null {
  const missing = token.match(/^missing:([A-Za-z0-9_$.-]+)$/)
  if (missing?.[1]) return {key: missing[1], operator: 'missing'}

  const exists = token.match(/^has:([A-Za-z0-9_$.-]+)$/)
  if (exists?.[1]) return {key: exists[1], operator: 'exists'}

  const comparison = token.match(/^([A-Za-z0-9_$.-]+)(!=|>=|<=|=|>|<)(.+)$/)
  if (comparison?.[1] && comparison[2] && comparison[3]) {
    return {
      key: comparison[1],
      operator: comparison[2] as ParsedExploreAttributeFilter['operator'],
      value: parseScalar(comparison[3]),
    } as ParsedExploreAttributeFilter
  }

  const contains = token.match(/^([A-Za-z0-9_$.-]+):(.+)$/)
  if (contains?.[1] && contains[2]) return {key: contains[1], operator: 'contains', value: parseScalar(contains[2])}

  return null
}

/** Parses the compact GitHub/X-style Explore query string. */
export function parseExploreQuery(query: string): ParsedExploreQuery {
  const terms: string[] = []
  const phrases: string[] = []
  const types: HMExploreResultType[] = []
  const attributes: ParsedExploreAttributeFilter[] = []
  let context: HMExploreContext['type'] | undefined

  for (const token of tokenizeExploreQuery(query.trim())) {
    if (!token) continue
    const type = token.match(/^type:(document|block|comment)$/)
    if (type && typeValues.has(type[1] as HMExploreResultType)) {
      types.push(type[1] as HMExploreResultType)
      continue
    }

    const contextMatch = token.match(/^in:(site|node)$/)
    if (contextMatch) {
      context = contextMatch[1] as HMExploreContext['type']
      continue
    }

    const attribute = parseAttributeToken(token)
    if (attribute) {
      attributes.push(attribute)
      continue
    }

    if (token.startsWith('"') && token.endsWith('"')) {
      const phrase = unquote(token)
      phrases.push(phrase)
      terms.push(`"${phrase}"`)
    } else {
      terms.push(token)
    }
  }

  return {text: terms.join(' '), terms, phrases, types: Array.from(new Set(types)), context, attributes}
}

function attributeValue(value: string | number | boolean) {
  return new AttributeValue({
    value:
      typeof value === 'number'
        ? {case: 'intValue', value: BigInt(value)}
        : typeof value === 'boolean'
          ? {case: 'boolValue', value}
          : {case: 'stringValue', value},
  })
}

function comparisonOperator(operator: ParsedExploreAttributeFilter['operator']) {
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

function attributeFilter(attribute: ParsedExploreAttributeFilter): DocumentFilter {
  if (attribute.operator === 'exists' || attribute.operator === 'missing') {
    return new DocumentFilter({
      filter: {
        case: attribute.operator === 'exists' ? 'exists' : 'missing',
        value: new DocumentFilter_Presence({key: attribute.key}),
      },
    })
  }

  if (attribute.operator === 'contains') {
    return new DocumentFilter({
      filter: {
        case: 'stringMatch',
        value: new DocumentFilter_StringMatch({
          key: attribute.key,
          value: String(attribute.value),
          caseSensitive: false,
        }),
      },
    })
  }
  const comparisonAttribute = attribute as ParsedExploreValuedAttributeFilter

  return new DocumentFilter({
    filter: {
      case: 'comparison',
      value: new DocumentFilter_Comparison({
        key: comparisonAttribute.key,
        operator: comparisonOperator(comparisonAttribute.operator),
        value: attributeValue(comparisonAttribute.value),
      }),
    },
  })
}

function contextFilter(context: HMExploreContext): DocumentFilter | null {
  if (context.type !== 'site') return null
  const url = packHmId({...context.id, version: null, blockRef: null, blockRange: null, latest: null})
  return new DocumentFilter({filter: {case: 'urlMatch', value: new DocumentFilter_URLMatch({url, prefix: true})}})
}

/** Builds a QueryDocuments DocumentFilter from parsed Explore query and context. */
export function buildExploreDocumentFilter(
  parsed: ParsedExploreQuery,
  context: HMExploreContext,
): DocumentFilter | undefined {
  const filters = [contextFilter(context), ...parsed.attributes.map(attributeFilter)].filter(
    (filter): filter is DocumentFilter => !!filter,
  )

  if (!filters.length) return undefined
  if (filters.length === 1) return filters[0]
  return new DocumentFilter({filter: {case: 'and', value: new DocumentFilter_And({filters})}})
}

/** Converts the existing SearchResultItem shape into a typed Explore result. */
export function searchResultItemToExploreResult(item: SearchResultItem): HMExploreResult | null {
  if (item.type === 'contact') return null
  if (item.type === 'comment' && item.commentId) {
    return {
      type: 'comment',
      documentId: item.id,
      commentId: item.commentId,
      matchText: item.title,
      breadcrumb: item.parentNames,
      versionTime: item.versionTime,
    }
  }
  if (item.type === 'document' && item.id.blockRef) {
    return {
      type: 'block',
      id: item.id,
      matchText: item.title,
      breadcrumb: item.parentNames,
      versionTime: item.versionTime,
    }
  }
  if (item.type === 'document') {
    return {
      type: 'document',
      id: item.id,
      matchText: item.title,
      breadcrumb: item.parentNames,
      versionTime: item.versionTime,
    }
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
