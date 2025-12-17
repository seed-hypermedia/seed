import {hmId} from '@shm/shared'
import {supportedLanguages} from '@shm/shared/language-packs'
import {useAccount} from '@shm/shared/models/entity'
import {Container} from '@shm/ui/container'
import {useDocumentLayout} from '@shm/ui/layout'
import {Separator} from '@shm/ui/separator'
import {Spinner} from '@shm/ui/spinner'
import {Text} from '@shm/ui/text'
import {cn} from '@shm/ui/utils'
import {Suspense, lazy} from 'react'
import {MyAccountBubble} from './account-bubble'
import {useLocalKeyPair} from './auth'
import WebCommenting from './commenting'
import type {SiteDocumentPayload} from './loaders'
import {NavigationLoadingContent, WebSiteProvider} from './providers'
import {WebSiteHeader} from './web-site-header'

const Feed = lazy(() => import('@shm/ui/feed').then((m) => ({default: m.Feed})))

export function FeedPage(
  props: SiteDocumentPayload & {prefersLanguages?: string[]},
) {
  const {siteHost, origin, prefersLanguages, dehydratedState} = props

  return (
    <WebSiteProvider
      origin={origin}
      originHomeId={props.originHomeId}
      siteHost={siteHost}
      prefersLanguages={supportedLanguages(prefersLanguages)}
      dehydratedState={dehydratedState}
    >
      <InnerFeedPage {...props} />
    </WebSiteProvider>
  )
}

function InnerFeedPage(
  props: SiteDocumentPayload & {prefersLanguages?: string[]},
) {
  const {homeMetadata, id, siteHost, originHomeId, origin, isLatest, document} =
    props

  const keyPair = useLocalKeyPair()
  const currentAccount = useAccount(keyPair?.id || undefined)

  const {
    showSidebars,
    elementRef,
    wrapperProps,
    sidebarProps,
    mainContentProps,
  } = useDocumentLayout({
    contentWidth: undefined,
    showSidebars: false,
  })

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
          <div
            className="relative flex h-full w-full flex-col"
            ref={elementRef}
          >
            <div className="flex flex-1 flex-col overflow-y-auto">
              <div
                {...wrapperProps}
                className={cn(
                  wrapperProps.className,
                  'flex pt-[var(--site-header-h)]',
                )}
              >
                {showSidebars ? (
                  <div
                    {...sidebarProps}
                    className={`${sidebarProps.className || ''} flex flex-col`}
                  />
                ) : null}
                <Container
                  clearVerticalSpace
                  {...mainContentProps}
                  className={cn(
                    mainContentProps.className,
                    'base-doc-container relative mt-5 gap-4 sm:mr-10 sm:ml-0',
                  )}
                >
                  <Text weight="bold" size="3xl">
                    What's New
                  </Text>
                  <Separator />

                  <Suspense
                    fallback={
                      <div className="flex items-center justify-center p-3">
                        <Spinner />
                      </div>
                    }
                  >
                    <Feed
                      commentEditor={<WebCommenting docId={id} />}
                      filterResource={`${id.id}*`}
                      currentAccount={currentAccount.data?.id.uid}
                      size="md"
                    />
                  </Suspense>
                </Container>
                {showSidebars ? (
                  <div
                    {...sidebarProps}
                    className={`${sidebarProps.className || ''} flex flex-col`}
                  />
                ) : null}
              </div>
              <MyAccountBubble />
            </div>
          </div>
        </NavigationLoadingContent>
      </div>
    </Suspense>
  )
}
