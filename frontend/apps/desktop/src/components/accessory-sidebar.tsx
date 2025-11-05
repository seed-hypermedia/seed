import {useAllDocumentCapabilities} from '@/models/access-control'
import {useSubscribedResource} from '@/models/entities'
import {useInteractionSummary} from '@/models/interaction-summary'
import {useChildrenActivity} from '@/models/library'
import {useNavigate} from '@/utils/useNavigate'
import {DocAccessoryOption} from '@shm/shared'
import {useTx, useTxString} from '@shm/shared/translation'
import {
  useNavigationDispatch,
  useNavigationState,
  useNavRoute,
  useRouteDocId,
} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@shm/ui/components/dropdown-menu'
import {panelContainerStyles} from '@shm/ui/container'
import {FeedFilters} from '@shm/ui/feed-filters'
import {Text} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {useResponsiveItems} from '@shm/ui/use-responsive-items'
import {cn} from '@shm/ui/utils'
import {
  ChevronDown,
  ChevronLeft,
  Folder,
  MessageSquare,
  Pencil,
  Sparkle,
  Users,
} from 'lucide-react'
import {useEffect, useMemo, useRef} from 'react'
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
  accessoryOptions,
  onAccessorySelect,
  mainPanelRef,
  isNewDraft = false,
}: {
  children: React.ReactNode
  accessory: React.ReactNode | null
  accessoryKey: Options[number]['key'] | undefined
  accessoryOptions: Options
  onAccessorySelect: (key: Options[number]['key'] | undefined) => void
  mainPanelRef?: React.RefObject<HTMLDivElement>
  isNewDraft?: boolean
}) {
  const docId = useRouteDocId()
  const panelsRef = useRef<ImperativePanelGroupHandle>(null)
  const accesoryPanelRef = useRef<ImperativePanelHandle>(null)
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
      return !!(accessory.openBlockId || accessory.openComment)
    }
    return false
  }, [route])

  // Handle back button click
  const handleBack = () => {
    if (!route || route.key !== 'document') return
    const accessory = route.accessory
    if (
      accessory?.key === 'discussions' &&
      (accessory.openBlockId || accessory.openComment)
    ) {
      replace({
        ...route,
        accessory: {
          ...accessory,
          openBlockId: undefined,
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

  const resource = useSubscribedResource(docId)

  const isDocument = resource.data?.type == 'document'
  const allDocumentCapabilities = useAllDocumentCapabilities(docId)
  const interactionSummary = useInteractionSummary(docId)
  const collaboratorCount =
    allDocumentCapabilities.data?.filter((c) => c.role !== 'agent')?.length ||
    undefined

  const childrenActivity = useChildrenActivity(docId, {
    enabled: isDocument,
  })
  const directoryCount = childrenActivity.data?.length || undefined
  const discussionsCount = interactionSummary.data?.comments

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
    <div className="flex h-full flex-1">
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
            <AccessoryTabs
              options={accessoryOptions}
              accessoryKey={accessoryKey}
              onAccessorySelect={onAccessorySelect}
              tabNumbers={{
                collaborators: collaboratorCount,
                directory: directoryCount,
                discussions: discussionsCount || 0,
              }}
            />
            <div className="border-border border-b px-5 py-3">
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

const iconNames = {
  collaborators: Users,
  directory: Folder,
  activity: Sparkle,
  discussions: MessageSquare,
  options: Pencil,
  contacts: Users,
} as const

// Stable width estimator function
const getAccessoryItemWidth = () => 60

function AccessoryTabs({
  options,
  accessoryKey,
  onAccessorySelect,
  tabNumbers,
}: {
  accessoryKey: DocAccessoryOption['key'] | undefined
  options: DocAccessoryOption[]
  onAccessorySelect: (key: DocAccessoryOption['key'] | undefined) => void
  tabNumbers?: Partial<Record<DocAccessoryOption['key'], number>>
}) {
  const paddingWidth = 16 // p-2 on both sides
  const dropdownButtonWidth = 36 // size-sm button width
  const gapWidth = 20 // gap-1 between items
  const reservedWidth = paddingWidth + dropdownButtonWidth + gapWidth

  const {containerRef, itemRefs, visibleItems, overflowItems} =
    useResponsiveItems({
      items: options,
      activeKey: accessoryKey,
      getItemWidth: getAccessoryItemWidth,
      reservedWidth,
      gapWidth,
    })

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="flex items-center justify-center gap-1 p-2 px-3"
      >
        {/* Hidden measurement container */}
        <div className="pointer-events-none absolute flex items-center gap-1 opacity-0">
          {options?.map((option) => {
            const isActive = accessoryKey === option.key
            const Icon = iconNames[option.key]
            return (
              <div
                key={`measure-${option.key}`}
                ref={(el) => {
                  if (el) {
                    itemRefs.current.set(option.key, el)
                  } else {
                    itemRefs.current.delete(option.key)
                  }
                }}
              >
                <Button size="sm" variant={isActive ? 'brand-12' : 'ghost'}>
                  {Icon ? <Icon className="size-4" /> : null}
                  {tabNumbers?.[option.key]
                    ? String(tabNumbers[option.key])
                    : null}
                </Button>
              </div>
            )
          })}
        </div>

        {/* Visible options */}
        {visibleItems.map((option) => {
          const isActive = accessoryKey === option.key
          const Icon = iconNames[option.key]
          return (
            <Tooltip content={option.label} key={option.key} side="bottom">
              <span>
                <Button
                  size="sm"
                  variant={isActive ? 'brand-12' : 'ghost'}
                  onClick={() => {
                    if (isActive) return
                    onAccessorySelect(option.key)
                  }}
                >
                  {Icon ? <Icon className="size-4" /> : null}
                  {tabNumbers?.[option.key]
                    ? String(tabNumbers[option.key])
                    : null}
                </Button>
              </span>
            </Tooltip>
          )
        })}

        {/* Overflow dropdown */}
        {overflowItems.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger>
              <Button size="sm" variant="ghost" className="rounded-full">
                <ChevronDown className="size-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end" className="w-50">
              {overflowItems.map((option) => {
                const Icon = iconNames[option.key]
                return (
                  <DropdownMenuItem
                    key={option.key}
                    onClick={() => {
                      onAccessorySelect(option.key)
                    }}
                  >
                    {Icon ? <Icon className="size-4" /> : null}
                    {option.label}
                    {tabNumbers?.[option.key] ? (
                      <DropdownMenuShortcut>
                        {String(tabNumbers[option.key])}
                      </DropdownMenuShortcut>
                    ) : null}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}
