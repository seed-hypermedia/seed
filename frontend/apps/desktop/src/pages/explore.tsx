import {MainWrapper} from '@/components/main-wrapper'
import {grpcClient} from '@/grpc-client'
import {useNavigate} from '@/utils/useNavigate'
import {
  buildExploreDocumentFilter,
  documentInfoToExploreResultDocument,
  parseExploreQuery,
  searchResultItemToExploreResult,
  type HMExploreResult,
  type HMExploreSort,
} from '@shm/shared/explore'
import {ContentTypeFilter, EntityKindFilter, QueryDocumentsResponse} from '@shm/shared/client/grpc-types'
import {prepareHMDocumentInfo} from '@shm/shared/models/entity'
import {useSearch} from '@shm/shared/models/search'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {packHmId} from '@shm/shared/utils/entity-id-url'
import {ExplorePage} from '@shm/ui/explore-page'
import {PanelContainer} from '@shm/ui/container'
import {useEffect, useMemo, useRef, useState} from 'react'

function resultKey(result: HMExploreResult) {
  if (result.type === 'comment') return `comment:${packHmId(result.documentId)}:${result.commentId}`
  return `${result.type}:${packHmId(result.id)}`
}

function contextLabel(route: Extract<ReturnType<typeof useNavRoute>, {key: 'explore'}>) {
  if (route.context.type === 'node') return 'Node'
  const path = route.context.id.path?.join('/')
  return path ? `Site: ${route.context.id.uid}/${path}` : `Site: ${route.context.id.uid}`
}

export default function ExploreDesktopPage() {
  const route = useNavRoute()
  const exploreRoute = route.key === 'explore' ? route : null
  const navigate = useNavigate()
  const replace = useNavigate('replace')
  const [documentResult, setDocumentResult] = useState<QueryDocumentsResponse | null>(null)
  const [documentError, setDocumentError] = useState<string | null>(null)
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false)
  const generation = useRef(0)

  const parsed = useMemo(() => parseExploreQuery(exploreRoute?.q || ''), [exploreRoute?.q])
  const context = exploreRoute?.context || ({type: 'node'} as const)
  const documentFilter = useMemo(() => buildExploreDocumentFilter(parsed, context), [parsed, context])
  const search = useSearch(parsed.text, {
    enabled: !!exploreRoute && !!parsed.text,
    includeBody: true,
    contextSize: 96,
    pageSize: 50,
    iriFilter:
      context.type === 'site'
        ? `hm://${context.id.uid}${context.id.path?.length ? `/${context.id.path.join('/')}*` : '*'}`
        : undefined,
    contentTypeFilter: [
      ContentTypeFilter.CONTENT_TYPE_TITLE,
      ContentTypeFilter.CONTENT_TYPE_DOCUMENT,
      ContentTypeFilter.CONTENT_TYPE_COMMENT,
    ],
    entityKindFilter: [
      EntityKindFilter.ENTITY_KIND_SPACE,
      EntityKindFilter.ENTITY_KIND_DOCUMENT,
      EntityKindFilter.ENTITY_KIND_COMMENT,
    ],
  })

  useEffect(() => {
    const current = ++generation.current
    const controller = new AbortController()
    setDocumentError(null)
    setIsLoadingDocuments(true)
    if (!exploreRoute) {
      setDocumentResult(null)
      setIsLoadingDocuments(false)
      return
    }
    grpcClient.documents
      .queryDocuments({filter: documentFilter, pageSize: 50}, {signal: controller.signal})
      .then((response) => {
        if (generation.current === current) setDocumentResult(response)
      })
      .catch((reason) => {
        if (!controller.signal.aborted && generation.current === current) {
          setDocumentResult(null)
          setDocumentError(reason instanceof Error ? reason.message : 'Document query failed.')
        }
      })
      .finally(() => {
        if (generation.current === current) setIsLoadingDocuments(false)
      })
    return () => controller.abort()
  }, [documentFilter, exploreRoute])

  const results = useMemo(() => {
    const next: HMExploreResult[] = []
    const seen = new Set<string>()
    const add = (result: HMExploreResult | null) => {
      if (!result) return
      if (parsed.types.length && !parsed.types.includes(result.type)) return
      const key = resultKey(result)
      if (seen.has(key)) return
      seen.add(key)
      next.push(result)
    }

    for (const document of documentResult?.documents || []) {
      add(documentInfoToExploreResultDocument(prepareHMDocumentInfo(document)))
    }
    for (const item of search.data?.entities || []) {
      add(searchResultItemToExploreResult(item))
    }
    return next
  }, [documentResult?.documents, parsed.types, search.data?.entities])

  const updateRoute = (update: {q?: string; sort?: HMExploreSort}) => {
    if (exploreRoute) replace({...exploreRoute, ...update})
  }

  const openResult = (result: HMExploreResult) => {
    if (result.type === 'comment') {
      navigate({key: 'comments', id: result.documentId, openComment: result.commentId})
      return
    }
    navigate({key: 'document', id: result.id})
  }

  if (!exploreRoute) return null

  return (
    <PanelContainer>
      <MainWrapper scrollable>
        <ExplorePage
          contextLabel={contextLabel(exploreRoute)}
          query={exploreRoute.q || ''}
          sort={exploreRoute.sort || 'relevance'}
          results={results}
          isLoading={isLoadingDocuments || search.isLoading}
          error={documentError || (search.error instanceof Error ? search.error.message : null)}
          onQueryChange={(q) => updateRoute({q})}
          onSortChange={(sort) => updateRoute({sort})}
          onOpenResult={openResult}
        />
      </MainWrapper>
    </PanelContainer>
  )
}
