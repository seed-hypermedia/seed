import {useListen} from '@/app-context'

import {SidebarContextProvider} from '@/sidebar-context'
import {getRouteKey, useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {getWindowType} from '@/utils/window-types'
import {NavRoute} from '@shm/shared/routes'
import {ReactElement, lazy, useMemo} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {Panel, PanelGroup} from 'react-resizable-panels'
import {YStack} from 'tamagui'
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
            <Panel id="page" order={2}>
              <PageComponent />
            </Panel>
          </PanelGroup>
          {sidebar}
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
    default:
      return {
        PageComponent: NotFoundPage,
        Fallback: BaseLoading,
      }
  }
}
