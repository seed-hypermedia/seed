import {useNavigate} from '@/utils/useNavigate'
import {DocAccessoryOption} from '@shm/shared'
import {useTx, useTxString} from '@shm/shared/translation'
import {
  useNavRoute,
  useNavigationDispatch,
  useNavigationState,
} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {panelContainerStyles} from '@shm/ui/container'
import {FeedFilters} from '@shm/ui/feed-filters'
import {Text} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {cn} from '@shm/ui/utils'
import {ChevronLeft, X} from 'lucide-react'
import {useEffect, useLayoutEffect, useMemo, useRef} from 'react'
import {
  ImperativePanelGroupHandle,
  ImperativePanelHandle,
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from 'react-resizable-panels'

// Remove the local hook definition since it's now imported

export function AccessoryLayout<Options extends DocAccessoryOption[]>({
  children,
  accessory,
  accessoryKey,
}: {
  children: React.ReactNode
  accessory: React.ReactNode | null
  accessoryKey: Options[number]['key'] | undefined
  accessoryOptions: Options
  onAccessorySelect: (key: Options[number]['key'] | undefined) => void
  mainPanelRef?: React.RefObject<HTMLDivElement>
  isNewDraft?: boolean
}) {
  const panelsRef = useRef<ImperativePanelGroupHandle>(null)
  const accesoryPanelRef = useRef<ImperativePanelHandle>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const prevAccessoryKey = useRef<Options[number]['key'] | undefined>(
    accessoryKey,
  )
  const state = useNavigationState()
  const dispatch = useNavigationDispatch()
  const tx = useTx()
  const txString = useTxString()
  const route = useNavRoute()
  const replace = useNavigate('replace')

  // Determine if we should show the back button
  const shouldShowBackButton = useMemo(() => {
    if (!route || route.key !== 'document') return false
    const accessory = route.accessory
    // Type guard to check if we're in discussions accessory
    if (accessory?.key === 'discussions') {
      return !!(accessory.targetBlockId || accessory.openComment)
    }
    return false
  }, [route])

  // Handle back button click
  const handleBack = () => {
    if (!route || route.key !== 'document') return
    const accessory = route.accessory
    if (
      accessory?.key === 'discussions' &&
      (accessory.targetBlockId || accessory.openComment)
    ) {
      replace({
        ...route,
        accessory: {
          ...accessory,
          targetBlockId: undefined,
          openComment: undefined,
        },
      })
    }
  }

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
      prevAccessoryKey.current === undefined && accessoryKey !== undefined

    console.log('[480px constraint] Effect running:', {
      prevAccessoryKey: prevAccessoryKey.current,
      currentAccessoryKey: accessoryKey,
      isOpening,
    })

    if (isOpening) {
      const container = containerRef.current
      console.log('[480px constraint] Panel opening, container:', !!container)

      if (container) {
        // Get the container width
        const containerWidth = container.getBoundingClientRect().width

        console.log('[480px constraint] Container width:', containerWidth)

        if (containerWidth) {
          const storedPercent = state?.accessoryWidth || 20
          const pixelValue = (storedPercent / 100) * containerWidth

          console.log('[480px constraint] Width calculation:', {
            storedPercent,
            pixelValue,
            needsAdjustment: pixelValue < 480,
          })

          // If the stored percentage would result in less than 480px, adjust it
          if (pixelValue < 480) {
            const newPercent = Math.min(50, (480 / containerWidth) * 100)
            console.log('[480px constraint] Adjusting to:', newPercent)
            dispatch({type: 'accessoryWidth', value: newPercent})
          }
        }
      }
    }

    prevAccessoryKey.current = accessoryKey
  }, [accessoryKey, state?.accessoryWidth, dispatch])

  let accessoryTitle = tx('Document Activity')
  if (accessoryKey == 'collaborators') {
    accessoryTitle = tx('Collaborators')
  } else if (accessoryKey == 'directory') {
    accessoryTitle = tx('Directory')
  } else if (accessoryKey == 'options') {
    accessoryTitle = tx('Draft Options')
  } else if (accessoryKey == 'activity') {
    accessoryTitle = tx('Document Activity')
  } else if (accessoryKey == 'discussions') {
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
        <Panel id="main" minSize={50} className="overflow-hidden pr-1">
          {children}
        </Panel>
        {accessoryKey !== undefined ? (
          <PanelResizeHandle className="panel-resize-handle" />
        ) : null}
        <Panel
          hidden={accessoryKey === undefined}
          id="accessory"
          ref={accesoryPanelRef}
          maxSize={50}
          minSize={20}
          defaultSize={state?.accessoryWidth || 20}
          onResize={(size) => {
            dispatch({type: 'accessoryWidth', value: size})
          }}
          className="pl-1"
        >
          <div
            className={cn(
              panelContainerStyles,
              'dark:bg-background flex flex-col bg-white',
            )}
          >
            <div className="border-border border-b px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                {shouldShowBackButton && (
                  <Tooltip content={txString('Back to All discussions')}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleBack}
                      className="h-7 px-2 text-xs"
                    >
                      <ChevronLeft className="size-3" />
                    </Button>
                  </Tooltip>
                )}
                <Text weight="semibold" size="lg" className="flex-1">
                  {accessoryTitle}
                </Text>
                <Button
                  size="icon"
                  onClick={() => {
                    if ('accessory' in route && route.accessory) {
                      replace({
                        ...route!,
                        accessory: null,
                      })
                    }
                  }}
                >
                  <X className="size-4" />
                </Button>
              </div>
              {accessoryKey == 'activity' ? (
                <FeedFilters
                  filterEventType={
                    route &&
                    (route.key === 'document' || route.key === 'feed') &&
                    route.accessory?.key == 'activity'
                      ? route.accessory?.filterEventType
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
                        accessory: {
                          ...(route.accessory as any),
                          filterEventType,
                        },
                      })
                    }
                  }}
                />
              ) : null}
            </div>
            {accessory}
          </div>
        </Panel>
      </PanelGroup>
    </div>
  )
}
