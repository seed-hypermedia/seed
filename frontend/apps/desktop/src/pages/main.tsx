import {useListen} from '@/app-context'

import {SidebarContextProvider} from '@/sidebar-context'
import {getRouteKey, useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {getWindowType} from '@/utils/window-types'
import {HMMetadata} from '@shm/shared'
import {NavRoute} from '@shm/shared/routes'
import {useDocumentLayout} from '@shm/ui/layout'
import {ReactElement, lazy, useMemo, useState} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {Panel, PanelGroup} from 'react-resizable-panels'
import {SizableText, XStack, YStack} from 'tamagui'
import {AppErrorPage} from '../components/app-error'
import {AutoUpdater} from '../components/auto-updater'
import Footer from '../components/footer'
import {AppSidebar} from '../components/sidebar'
import {TitleBar} from '../components/titlebar'
import {BaseLoading, NotFoundPage} from './base'
import {DocumentPlaceholder} from './document-placeholder'
import './polyfills'

var Settings = lazy(() => import('./settings'))
var Contacts = lazy(() => import('./contacts-page'))
var Document = lazy(() => import('./document'))
var Draft = lazy(() => import('./draft'))
var Library = lazy(() => import('./library'))
var DeletedContent = lazy(() => import('./deleted-content'))
var Drafts = lazy(() => import('./drafts'))

export default function Main({className}: {className?: string}) {
  const navR = useNavRoute()
  const navigate = useNavigate()
  const {PageComponent, Fallback} = useMemo(
    () => getPageComponent(navR),
    [navR],
  )
  const routeKey = useMemo(() => getRouteKey(navR), [navR])
  useListen<NavRoute>(
    'open_route',
    (event) => {
      const route = event.payload
      navigate(route)
    },
    [navigate],
  )
  const windowType = getWindowType()
  let titlebar: ReactElement | null = null
  let sidebar: ReactElement | null = null
  if (windowType === 'main') {
    titlebar = <TitleBar />
    sidebar = <AppSidebar />
  } else if (windowType === 'settings') {
    titlebar = (
      <TitleBar
        height={26}
        minHeight={26}
        ai="center"
        jc="center"
        clean
        cleanTitle="Settings"
      />
    )
    return (
      <YStack fullscreen className={className}>
        <ErrorBoundary
          key={routeKey}
          FallbackComponent={AppErrorPage}
          onReset={() => {
            window.location.reload()
          }}
        >
          {titlebar}
          <PageComponent />
        </ErrorBoundary>
      </YStack>
    )
    // titlebar = (
    //   <XStack
    //     bg="$transparent"
    //     h={26}
    //     ai="center"
    //     jc="center"
    //     className="window-drag"
    //   >
    //     <SizableText size="$1.5" fontWeight="bold">
    //       Settings
    //     </SizableText>
    //   </XStack>
    // )
  } else if (windowType === 'deleted-content') {
    titlebar = <TitleBar clean cleanTitle="Review Deleted Content" />
  }

  return (
    <YStack fullscreen className={className}>
      <SidebarContextProvider>
        <ErrorBoundary
          key={routeKey}
          FallbackComponent={AppErrorPage}
          onReset={() => {
            window.location.reload()
          }}
        >
          {titlebar}
          <PanelGroup direction="horizontal" style={{flex: 1}}>
            {sidebar}
            <Panel id="page" order={2}>
              <PageComponent />
            </Panel>
          </PanelGroup>
          <Footer />
          <AutoUpdater />
        </ErrorBoundary>
      </SidebarContextProvider>
    </YStack>
  )
}

function getPageComponent(navRoute: NavRoute) {
  switch (navRoute.key) {
    case 'contacts':
      return {
        PageComponent: Contacts,
        Fallback: BaseLoading,
      }
    case 'document':
      return {
        PageComponent: Document,
        Fallback: DocumentPlaceholder,
      }
    case 'draft':
      return {
        PageComponent: Draft,
        Fallback: DocumentPlaceholder,
      }
    case 'settings':
      return {
        PageComponent: Settings,
        Fallback: BaseLoading,
      }
    case 'library': {
      return {
        PageComponent: Library,
        Fallback: BaseLoading,
      }
    }
    case 'deleted-content':
      return {
        PageComponent: DeletedContent,
        Fallback: BaseLoading,
      }
    case 'drafts':
      return {
        PageComponent: Drafts,
        Fallback: BaseLoading,
      }
    default:
      return {
        PageComponent: NotFoundPage,
        Fallback: BaseLoading,
      }
  }
}

function NewLayout() {
  const [contentWidth, setContentWidth] =
    useState<HMMetadata['contentWidth']>('M')
  const [shouldShowSidebars, setShouldShowSidebars] = useState(true)

  const {showSidebars, elementRef, showCollapsed, maxWidth, contentMaxWidth} =
    useDocumentLayout({
      contentWidth,
      showSidebars: shouldShowSidebars,
    })
  return (
    <>
      <YStack padding={25}>
        <XStack gap="$4" alignItems="center" flexWrap="wrap">
          <SizableText>Content Width:</SizableText>
          <select
            value={contentWidth}
            onChange={(e) =>
              setContentWidth(e.target.value as HMMetadata['contentWidth'])
            }
            style={{
              padding: '8px',
              borderRadius: '4px',
              border: '1px solid #ccc',
            }}
          >
            <option value="S">Small</option>
            <option value="M">Medium</option>
            <option value="L">Large</option>
          </select>

          <XStack gap="$2" alignItems="center" marginLeft="$4">
            <input
              type="checkbox"
              id="showSidebars"
              checked={shouldShowSidebars}
              onChange={(e) => setShouldShowSidebars(e.target.checked)}
              style={{width: '16px', height: '16px'}}
            />
            <label htmlFor="showSidebars">
              <SizableText>Show Sidebars</SizableText>
            </label>
          </XStack>
        </XStack>
      </YStack>
      <YStack flex={1} ref={elementRef} w="100%">
        <XStack
          maxWidth={maxWidth}
          marginHorizontal="auto"
          width="100%"
          justifyContent="space-between"
          bg="lightblue"
          flex={1}
        >
          {showSidebars ? (
            <YStack
              bg="blue"
              width="100%"
              maxWidth={showCollapsed ? 40 : 280}
              flex={1}
              paddingRight={showCollapsed ? 0 : 40}
              className="document-aside"
            >
              <SizableText>sidebar left</SizableText>
            </YStack>
          ) : null}
          <YStack maxWidth={contentMaxWidth} width="100%" p={40}>
            <pre>
              <SizableText size="$5">
                {JSON.stringify(
                  {
                    showSidebars,
                    showCollapsed,
                    maxWidth,
                    contentMaxWidth,
                  },
                  null,
                  2,
                )}
              </SizableText>
            </pre>
          </YStack>
          {showSidebars ? (
            <YStack
              bg="blue"
              width="100%"
              maxWidth={showCollapsed ? 40 : 280}
              flex={1}
            >
              <SizableText>sidebar right</SizableText>
            </YStack>
          ) : null}
        </XStack>
      </YStack>
    </>
  )
}
