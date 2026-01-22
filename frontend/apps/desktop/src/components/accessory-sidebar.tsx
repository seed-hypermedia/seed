import {useNavigate} from '@/utils/useNavigate'
import {PanelSelectionOptions} from '@shm/shared'
import {useTx} from '@shm/shared/translation'
import {
  useNavigationDispatch,
  useNavigationState,
  useNavRoute,
} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {panelContainerStyles} from '@shm/ui/container'
import {FeedFilters} from '@shm/ui/feed-filters'
import {Text} from '@shm/ui/text'
import {cn} from '@shm/ui/utils'
import {X} from 'lucide-react'
import {useEffect, useLayoutEffect, useMemo, useRef} from 'react'
import {
  ImperativePanelGroupHandle,
  ImperativePanelHandle,
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from 'react-resizable-panels'

export function AccessoryLayout({
  children,
  panelUI,
  panelKey,
}: {
  children: React.ReactNode
  panelUI: React.ReactNode | null
  panelKey: PanelSelectionOptions | undefined
}) {
  const panelsRef = useRef<ImperativePanelGroupHandle>(null)
  const accesoryPanelRef = useRef<ImperativePanelHandle>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const prevPanelKey = useRef<PanelSelectionOptions | undefined>(panelKey)
  const state = useNavigationState()
  const dispatch = useNavigationDispatch()
  const tx = useTx()
  const route = useNavRoute()
  const replace = useNavigate('replace')

  const widthStorage = useMemo(
    () => ({
      getItem(name: string) {
        try {
          return String(state?.accessoryWidth || 0)
        } catch (e) {
          console.error('Error getting sidebar width from storage', {e})
          return '0'
        }
      },
      setItem(name: string, value: string) {
        try {
          const data = JSON.parse(value)
          // Extract the first value from the layout array which represents the sidebar width percentage
          const accessoryWidth = data['accessory,main']?.layout[1]

          if (typeof accessoryWidth === 'number') {
            dispatch({type: 'accessoryWidth', value: accessoryWidth})
          }
        } catch (e) {
          console.error('Error setting sidebar width in storage', {e})
        }
      },
    }),
    [state?.sidebarLocked, state?.accessoryWidth],
  )

  useEffect(() => {
    const panelGroup = panelsRef.current
    if (panelGroup) {
      if (state?.accessoryWidth && state?.accessoryWidth > 0) {
        panelGroup.setLayout([
          100 - state?.accessoryWidth,
          state?.accessoryWidth,
        ])
      } else {
        panelGroup.setLayout([100, 0])
      }
    }
  }, [state?.accessoryWidth])

  // Enforce 480px minimum when opening the accessory panel
  useLayoutEffect(() => {
    const isOpening =
      prevPanelKey.current === undefined && panelKey !== undefined

    if (isOpening) {
      const container = containerRef.current
      console.log('[480px constraint] Panel opening, container:', !!container)

      if (container) {
        const containerWidth = container.getBoundingClientRect().width

        console.log('[480px constraint] Container width:', containerWidth)

        if (containerWidth) {
          const storedPercent = state?.accessoryWidth || 20
          const pixelValue = (storedPercent / 100) * containerWidth

          // If the stored percentage would result in less than 480px, adjust it
          if (pixelValue < 480) {
            const newPercent = Math.min(50, (480 / containerWidth) * 100)
            console.log('[480px constraint] Adjusting to:', newPercent)
            dispatch({type: 'accessoryWidth', value: newPercent})
          }
        }
      }
    }

    prevPanelKey.current = panelKey
  }, [panelKey, state?.accessoryWidth, dispatch])

  let accessoryTitle = tx('Document Activity')
  if (panelKey == 'collaborators') {
    accessoryTitle = tx('Collaborators')
  } else if (panelKey == 'directory') {
    accessoryTitle = tx('Directory')
  } else if (panelKey == 'options') {
    accessoryTitle = tx('Draft Options')
  } else if (panelKey == 'activity') {
    accessoryTitle = tx('Document Activity')
  } else if (panelKey == 'discussions') {
    accessoryTitle = tx('Discussions')
  }

  return (
    <div ref={containerRef} className="flex h-full flex-1">
      <PanelGroup
        direction="horizontal"
        ref={panelsRef}
        style={{flex: 1}}
        autoSaveId="accessory"
        storage={widthStorage}
      >
        <Panel id="main" minSize={50} className="p-0.5 pr-1">
          <div className="h-full rounded-lg">{children}</div>
        </Panel>
        {panelKey !== undefined ? (
          <PanelResizeHandle className="panel-resize-handle" />
        ) : null}
        <Panel
          hidden={panelKey === undefined}
          id="accessory"
          ref={accesoryPanelRef}
          maxSize={50}
          minSize={20}
          defaultSize={state?.accessoryWidth || 20}
          onResize={(size) => {
            dispatch({type: 'accessoryWidth', value: size})
          }}
          className="p-0.5 pl-1"
        >
          <div className="h-full rounded-lg">
            <div
              className={cn(
                panelContainerStyles,
                'dark:bg-background flex flex-col bg-white',
              )}
            >
              <div className="border-border border-b px-5 py-3">
                <div className="flex items-center justify-between gap-2">
                  <Text weight="semibold" size="lg" className="flex-1">
                    {accessoryTitle}
                  </Text>
                  <Button
                    size="icon"
                    onClick={() => {
                      if ('panel' in route && route.panel) {
                        replace({
                          ...route!,
                          panel: null,
                        })
                      }
                    }}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
                {panelKey == 'activity' ? (
                  <FeedFilters
                    filterEventType={
                      route &&
                      (route.key === 'document' || route.key === 'feed') &&
                      route.panel?.key == 'activity'
                        ? route.panel?.filterEventType
                        : undefined
                    }
                    onFilterChange={({
                      filterEventType,
                    }: {
                      filterEventType?: string[]
                    }) => {
                      console.log('== ~ FILTER onFilterChange', filterEventType)
                      if (
                        route &&
                        (route.key === 'document' || route.key === 'feed')
                      ) {
                        replace({
                          ...route,
                          panel: {
                            ...(route.panel as any),
                            filterEventType,
                          },
                        })
                      }
                    }}
                  />
                ) : null}
              </div>
              {panelUI}
            </div>
          </div>
        </Panel>
      </PanelGroup>
    </div>
  )
}
