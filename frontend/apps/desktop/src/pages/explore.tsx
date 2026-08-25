import {MainWrapper} from '@/components/main-wrapper'
import {useNavigate} from '@/utils/useNavigate'
import {parseExploreQuery, type HMExploreResult} from '@shm/shared/explore'
import {useExploreResults} from '@shm/shared/models/explore'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {ExplorePage} from '@shm/ui/explore-page'
import {PanelContainer} from '@shm/ui/container'
import {useMemo} from 'react'

function contextLabel(route: Extract<ReturnType<typeof useNavRoute>, {key: 'explore'}>) {
  if (route.context.type === 'node') return 'Node'
  const path = route.context.id.path?.join('/')
  return path ? `Space: ${route.context.id.uid}/${path}` : `Space: ${route.context.id.uid}`
}

export default function ExploreDesktopPage() {
  const route = useNavRoute()
  const exploreRoute = route.key === 'explore' ? route : null
  const navigate = useNavigate()
  const replace = useNavigate('replace')
  const rawQuery = exploreRoute?.q || ''
  const legacySort = exploreRoute?.sort && !/\bsort:/.test(rawQuery) ? `sort:${exploreRoute.sort}` : ''
  const query = [rawQuery, legacySort].filter(Boolean).join(' ')
  const parsed = useMemo(() => parseExploreQuery(query), [query])
  const context = exploreRoute?.context || ({type: 'node'} as const)
  const explore = useExploreResults(parsed, context, {enabled: !!exploreRoute})
  const results = explore.results

  const updateRoute = (q: string) => {
    if (exploreRoute) replace({...exploreRoute, q, sort: undefined})
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
          query={query}
          parsed={parsed}
          results={results}
          counts={explore.counts}
          textTerms={explore.textTerms}
          diagnostics={explore.diagnostics}
          blocksByDocument={explore.blocksByDocument}
          hasMore={explore.hasMore}
          intersectionPending={explore.intersectionPending}
          intersectionTruncated={explore.intersectionTruncated}
          onLoadMore={explore.loadMore}
          isLoading={explore.isLoading}
          error={explore.error instanceof Error ? explore.error.message : null}
          onQueryChange={updateRoute}
          accountUid={exploreRoute.context?.type === 'space' ? exploreRoute.context.id.uid : undefined}
          context={context}
          onScopeChange={(nextContext) => {
            if (exploreRoute) replace({...exploreRoute, context: nextContext, sort: undefined})
          }}
          onOpenResult={openResult}
        />
      </MainWrapper>
    </PanelContainer>
  )
}
