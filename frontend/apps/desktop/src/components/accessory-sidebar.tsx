import {useAllDocumentCapabilities} from '@/models/access-control'
import {useSortedCitations} from '@/models/citations'
import {useAllDocumentComments} from '@/models/comments'
import {useSubscribedEntity} from '@/models/entities'
import {useChildrenActivity} from '@/models/library'
import {useDocumentChanges} from '@/models/versions'
import {
  useNavigationDispatch,
  useNavigationState,
  useRouteDocId,
} from '@/utils/navigation'
import {DocAccessoryOption} from '@shm/shared'
import {useTx} from '@shm/shared/translation'
import {Button} from '@shm/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@shm/ui/components/popover'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {panelContainerStyles} from '@shm/ui/container'
import {BlockQuote} from '@shm/ui/icons'
import {Text} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {cn} from '@shm/ui/utils'
import {
  ChevronDown,
  Clock,
  Folder,
  MessageSquare,
  Pencil,
  Sparkle,
  Users,
} from 'lucide-react'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {
  ImperativePanelGroupHandle,
  ImperativePanelHandle,
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from 'react-resizable-panels'

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

  let accessoryTitle = tx('Activity')
  if (accessoryKey == 'collaborators') {
    accessoryTitle = tx('Collaborators')
  } else if (accessoryKey == 'directory') {
    accessoryTitle = tx('Directory')
  } else if (accessoryKey == 'discussions') {
    accessoryTitle = tx('Discussions')
  } else if (accessoryKey == 'options') {
    accessoryTitle = tx('Draft Options')
  } else if (accessoryKey == 'versions') {
    accessoryTitle = tx('Versions')
  } else if (accessoryKey == 'citations') {
    accessoryTitle = tx('Citations')
  } else if (accessoryKey == 'activity') {
    accessoryTitle = tx('All')
  }

  const entity = useSubscribedEntity(docId)
  const allDocumentCapabilities = useAllDocumentCapabilities(docId)
  const collaboratorCount =
    allDocumentCapabilities.data?.filter((c) => c.role !== 'agent')?.length ||
    undefined
  const activeChangeCount = useDocumentChanges(docId).data?.length || undefined
  const comments = useAllDocumentComments(docId)
  const commentCount = comments.data?.length || undefined
  const citations = useSortedCitations(docId, {
    enabled: !!entity.data?.document,
  })
  const citationCount = citations.docCitations.length || undefined
  const childrenActivity = useChildrenActivity(docId)
  const directoryCount = childrenActivity.data?.length || undefined
  return (
    <div className="flex h-full flex-1">
      <PanelGroup
        direction="horizontal"
        ref={panelsRef}
        style={{flex: 1}}
        autoSaveId="accessory"
        storage={widthStorage}
      >
        <Panel id="main" minSize={50} className="overflow-hidden pr-2 pl-1">
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
          className="px-2"
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
                versions: activeChangeCount,
                discussions: commentCount,
                citations: citationCount,
                directory: directoryCount,
              }}
            />
            <div className="border-border border-b px-5 py-3">
              <Text weight="semibold" size="lg">
                {accessoryTitle}
              </Text>
            </div>
            {accessory}
          </div>
        </Panel>
      </PanelGroup>
    </div>
  )
}

export function AccessoryContent({
  children,
  footer,
  title,
  ...props
}: {
  children?: React.ReactNode
  footer?: React.ReactNode
  title?: string
}) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden" {...props}>
      <ScrollArea>
        <div className="flex flex-col gap-2 p-3">{children}</div>
      </ScrollArea>
      {footer ? (
        <div className="border-border bg-background m-2 max-h-1/2 rounded-md border py-2 dark:bg-black">
          <ScrollArea>{footer}</ScrollArea>
        </div>
      ) : null}
    </div>
  )
}

const iconNames = {
  activity: Sparkle,
  collaborators: Users,
  directory: Folder,
  discussions: MessageSquare,
  options: Pencil,
  versions: Clock,
  citations: BlockQuote,
  'suggested-changes': Sparkle,
  contacts: Sparkle,
} as const

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
  const containerRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Map<string, HTMLElement>>(new Map())
  const [visibleOptions, setVisibleOptions] = useState<DocAccessoryOption[]>([])
  const [overflowOptions, setOverflowOptions] = useState<DocAccessoryOption[]>(
    [],
  )

  // Calculate which items fit in the available space
  const updateVisibility = useCallback(() => {
    if (!containerRef.current || !options?.length) {
      setVisibleOptions([])
      setOverflowOptions([])
      return
    }

    const container = containerRef.current
    const containerWidth = container.getBoundingClientRect().width

    // Reserve space for padding and potential dropdown button
    const paddingWidth = 16 // p-2 on both sides
    const dropdownButtonWidth = 36 // size-sm button width
    const gapWidth = 20 // gap-1 between items
    const reservedWidth = paddingWidth + dropdownButtonWidth + gapWidth
    const availableWidth = containerWidth - reservedWidth

    const visible: DocAccessoryOption[] = []
    const overflow: DocAccessoryOption[] = []

    // Create array of options with their measured widths
    const optionWidths: Array<{
      option: DocAccessoryOption
      width: number
      isActive: boolean
    }> = []

    for (const option of options) {
      const element = itemRefs.current.get(option.key)
      const isActive = accessoryKey === option.key
      if (element) {
        const width = element.getBoundingClientRect().width + gapWidth
        optionWidths.push({option, width, isActive})
      } else {
        // If we can't measure, use an estimate
        optionWidths.push({option, width: 60, isActive})
      }
    }

    // Find the active option and reserve space for it first
    const activeOptionData = optionWidths.find(({isActive}) => isActive)
    let remainingWidth = availableWidth

    if (activeOptionData) {
      remainingWidth -= activeOptionData.width
    }

    // Now go through options in original order and add them if they fit
    for (const {option, width, isActive} of optionWidths) {
      if (isActive) {
        // Always include the active option (space already reserved)
        visible.push(option)
      } else {
        // For non-active options, only add if there's remaining space
        if (width <= remainingWidth) {
          visible.push(option)
          remainingWidth -= width
        } else {
          overflow.push(option)
        }
      }
    }

    // Ensure we show at least one option (fallback)
    if (visible.length === 0 && options.length > 0) {
      visible.push(options[0])
      const firstOverflowIndex = overflow.findIndex(
        (option) => option.key === options[0].key,
      )
      if (firstOverflowIndex !== -1) {
        overflow.splice(firstOverflowIndex, 1)
      }
    }

    setVisibleOptions(visible)
    setOverflowOptions(overflow)
  }, [options, accessoryKey])

  // Update visibility when options change
  useEffect(() => {
    updateVisibility()

    // Second update after render to ensure accurate measurements
    const timer = setTimeout(() => {
      updateVisibility()
    }, 100)

    return () => clearTimeout(timer)
  }, [options, updateVisibility])

  // Setup resize observer
  useEffect(() => {
    if (!containerRef.current) return

    const observer = new ResizeObserver(() => {
      updateVisibility()
    })

    observer.observe(containerRef.current)
    window.addEventListener('resize', updateVisibility)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateVisibility)
    }
  }, [updateVisibility])

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
        {visibleOptions.map((option) => {
          const isActive = accessoryKey === option.key
          const Icon = iconNames[option.key]
          return (
            <Tooltip content={option.label} key={option.key}>
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
        {overflowOptions.length > 0 && (
          <Popover>
            <PopoverTrigger>
              <Button size="sm" variant="ghost" className="rounded-full">
                <ChevronDown className="size-5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="max-h-[300px] overflow-y-scroll p-0"
              align="end"
              side="bottom"
            >
              {overflowOptions.map((option) => {
                const isActive = accessoryKey === option.key
                const Icon = iconNames[option.key]
                return (
                  <div
                    key={option.key}
                    className={cn(
                      'hover:bg-accent flex cursor-pointer items-center gap-2 p-2',
                      isActive && 'bg-accent',
                    )}
                    onClick={() => {
                      if (isActive) return
                      onAccessorySelect(option.key)
                    }}
                  >
                    {Icon ? <Icon className="size-4" /> : null}
                    <span className="text-sm">{option.label}</span>
                    {tabNumbers?.[option.key] ? (
                      <span className="text-muted-foreground text-xs">
                        {String(tabNumbers[option.key])}
                      </span>
                    ) : null}
                  </div>
                )
              })}
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  )
}
