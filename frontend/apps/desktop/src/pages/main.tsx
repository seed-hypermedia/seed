import {useListen} from '@/app-context'

import {SidebarContextProvider, useSidebarContext} from '@/sidebar-context'
import {getRouteKey, useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {getWindowType} from '@/utils/window-types'
import {HMMetadata} from '@shm/shared'
import {NavRoute} from '@shm/shared/routes'
import {useDocumentLayout} from '@shm/ui/layout'
import {TitlebarWrapper, TitleText} from '@shm/ui/titlebar'
import {useIsDark} from '@shm/ui/use-is-dark'
import {useStream} from '@shm/ui/use-stream'
import {
  lazy,
  ReactElement,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {
  ImperativePanelGroupHandle,
  Panel,
  PanelGroup,
} from 'react-resizable-panels'
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
  const isDark = useIsDark()
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
      <TitlebarWrapper
        height={26}
        minHeight={26}
        bg={isDark ? '$background' : '$backgroundStrong'}
      >
        <XStack className="window-drag" ai="center" jc="center" w="100%">
          <TitleText
            marginHorizontal="$4"
            fontWeight="bold"
            f={1}
            textAlign="center"
          >
            Settings
          </TitleText>
        </XStack>
      </TitlebarWrapper>
    )
    return (
      <YStack
        fullscreen
        className={className}
        bg={isDark ? '$backgroundStrong' : '$background'}
      >
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
  } else if (windowType === 'deleted-content') {
    titlebar = (
      <TitlebarWrapper
        height={26}
        minHeight={26}
        bg={isDark ? '$background' : '$backgroundStrong'}
      >
        <XStack className="window-drag" ai="center" jc="center" w="100%">
          <TitleText
            marginHorizontal="$4"
            fontWeight="bold"
            f={1}
            textAlign="center"
          >
            Review Deleted Content
          </TitleText>
        </XStack>
      </TitlebarWrapper>
    )
  }

  return (
    <YStack
      fullscreen
      className={className}
      bg={isDark ? '$backgroundStrong' : '$background'}
    >
      <SidebarContextProvider>
        <ErrorBoundary
          key={routeKey}
          FallbackComponent={AppErrorPage}
          onReset={() => {
            window.location.reload()
          }}
        >
          {titlebar}
          <XStack flex={1} h="100%">
            <PanelContent>
              {sidebar}
              <Panel id="page" order={2}>
                <PageComponent />
              </Panel>
            </PanelContent>
          </XStack>
          <Footer />
          <AutoUpdater />
        </ErrorBoundary>
      </SidebarContextProvider>
    </YStack>
  )
}

function PanelContent({children}: {children: ReactNode}) {
  const ctx = useSidebarContext()
  const isLocked = useStream(ctx.isLocked)
  const sidebarWidth = useStream(ctx.sidebarWidth)
  const ref = useRef<ImperativePanelGroupHandle>(null)

  useEffect(() => {
    const panelGroup = ref.current
    if (panelGroup) {
      if (isLocked && sidebarWidth && sidebarWidth > 0) {
        panelGroup.setLayout([sidebarWidth, 100 - sidebarWidth])
      } else {
        if (isLocked && sidebarWidth && sidebarWidth === 0) {
          panelGroup.setLayout([15, 85])
        } else {
          panelGroup.setLayout([0, 100])
        }
      }
    }
  }, [sidebarWidth])
  return (
    <PanelGroup
      ref={ref}
      direction="horizontal"
      style={{flex: 1}}
      autoSaveId="main"
      storage={ctx.widthStorage}
    >
      {children}
    </PanelGroup>
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
