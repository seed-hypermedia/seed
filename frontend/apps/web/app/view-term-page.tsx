import {hmId, UnpackedHypermediaId, ViewRouteKey} from '@shm/shared'
import {supportedLanguages} from '@shm/shared/language-packs'
import {useAccount} from '@shm/shared/models/entity'
import {useInteractionSummary} from '@shm/shared/models/interaction-summary'
import {Discussions} from '@shm/ui/comments'
import {panelContainerStyles} from '@shm/ui/container'
import {ReadOnlyCollaboratorsContent} from '@shm/ui/collaborators-page'
import {
  DirectoryEmpty,
  DirectoryListView,
  useDirectoryData,
} from '@shm/ui/directory-page'
import {DocumentTools} from '@shm/ui/document-tools'
import {PageLayout} from '@shm/ui/page-layout'
import {Spinner} from '@shm/ui/spinner'
import {cn} from '@shm/ui/utils'
import {lazy, Suspense} from 'react'
import {MyAccountBubble} from './account-bubble'
import {useLocalKeyPair} from './auth'
import WebCommenting from './commenting'
import type {SiteDocumentPayload} from './loaders'
import {NavigationLoadingContent, WebSiteProvider} from './providers'
import {WebSiteHeader} from './web-site-header'

// Lazy load heavy components
const LazyFeed = lazy(() =>
  import('@shm/ui/feed').then((m) => ({default: m.Feed})),
)

type ViewTermPageProps = SiteDocumentPayload & {
  prefersLanguages?: string[]
  viewTerm: ViewRouteKey
}

export function ViewTermPage(props: ViewTermPageProps) {
  const {siteHost, origin, prefersLanguages, dehydratedState} = props

  return (
    <WebSiteProvider
      origin={origin}
      originHomeId={props.originHomeId}
      siteHost={siteHost}
      prefersLanguages={supportedLanguages(prefersLanguages)}
      dehydratedState={dehydratedState}
    >
      <InnerViewTermPage {...props} />
    </WebSiteProvider>
  )
}

function InnerViewTermPage(props: ViewTermPageProps) {
  const {homeMetadata, id, originHomeId, origin, isLatest, document, viewTerm} =
    props

  const keyPair = useLocalKeyPair()
  const currentAccount = useAccount(keyPair?.id || undefined)
  const interactionSummary = useInteractionSummary(id)
  const {directoryItems} = useDirectoryData(id)

  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center">
          <Spinner />
        </div>
      }
    >
      <div className="bg-panel flex h-screen max-h-screen min-h-svh w-screen flex-col overflow-hidden">
        <WebSiteHeader
          noScroll={false}
          homeMetadata={homeMetadata}
          originHomeId={originHomeId}
          siteHomeId={hmId(id.uid)}
          docId={id}
          document={document}
          origin={origin}
          isLatest={isLatest}
        />
        <NavigationLoadingContent className="dark:bg-background flex flex-1 overflow-hidden bg-white">
          <div className="relative flex h-full w-full flex-1 flex-col overflow-auto">
            <div
              className={cn(
                panelContainerStyles,
                'pt-[var(--site-header-h)] sm:pt-0',
              )}
            >
              <DocumentTools
                id={id}
                activeTab={viewTerm}
                commentsCount={interactionSummary.data?.comments || 0}
                directoryCount={directoryItems.length}
              />
              <ViewTermContent
                viewTerm={viewTerm}
                docId={id}
                currentAccountId={currentAccount.data?.id.uid}
              />
            </div>
            <MyAccountBubble />
          </div>
        </NavigationLoadingContent>
      </div>
    </Suspense>
  )
}

function ViewTermContent({
  viewTerm,
  docId,
  currentAccountId,
}: {
  viewTerm: ViewRouteKey
  docId: SiteDocumentPayload['id']
  currentAccountId?: string
}) {
  switch (viewTerm) {
    case 'activity':
      return (
        <PageLayout title="Activity" centered>
          <Suspense
            fallback={
              <div className="flex items-center justify-center p-8">
                <Spinner />
              </div>
            }
          >
            <LazyFeed
              filterResource={docId.id}
              currentAccount={currentAccountId}
              size="md"
              centered
            />
          </Suspense>
        </PageLayout>
      )

    case 'discussions':
      return (
        <WebDiscussionsContent
          docId={docId}
          currentAccountId={currentAccountId}
        />
      )

    case 'directory':
      return <WebDirectoryContent docId={docId} />

    case 'collaborators':
      return (
        <PageLayout title="Collaborators" centered>
          <ReadOnlyCollaboratorsContent docId={docId} />
        </PageLayout>
      )

    default:
      return null
  }
}

// Web-specific discussions content (doesn't depend on useNavRoute)
function WebDiscussionsContent({
  docId,
  currentAccountId,
}: {
  docId: UnpackedHypermediaId
  currentAccountId?: string
}) {
  return (
    <PageLayout title="Discussions" centered>
      <Discussions
        commentEditor={<WebCommenting docId={docId} />}
        targetId={docId}
        currentAccountId={currentAccountId}
        centered
      />
    </PageLayout>
  )
}

// Web-specific directory content (doesn't depend on useNavRoute)
function WebDirectoryContent({docId}: {docId: UnpackedHypermediaId}) {
  const {directoryItems, isInitialLoading} = useDirectoryData(docId)

  if (isInitialLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Spinner className="size-8" />
      </div>
    )
  }

  return (
    <PageLayout title="Directory" centered>
      <div className="p-6">
        {directoryItems.length === 0 ? (
          <DirectoryEmpty />
        ) : (
          <DirectoryListView items={directoryItems} />
        )}
      </div>
    </PageLayout>
  )
}
