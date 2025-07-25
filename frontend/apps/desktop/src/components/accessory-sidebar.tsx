import {useAllDocumentCapabilities} from '@/models/access-control'
import {useSortedCitations} from '@/models/citations'
import {useAllDocumentComments} from '@/models/comments'
import {useSubscribedResource} from '@/models/entities'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@shm/ui/components/dropdown-menu'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {panelContainerStyles} from '@shm/ui/container'
import {BlockQuote} from '@shm/ui/icons'
import {Text} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {useResponsiveItems} from '@shm/ui/use-responsive-items'
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

  const resource = useSubscribedResource(docId)
  const isDocument = resource.data?.type === 'document'
  const allDocumentCapabilities = useAllDocumentCapabilities(docId)
  const collaboratorCount =
    allDocumentCapabilities.data?.filter((c) => c.role !== 'agent')?.length ||
    undefined
  const activeChangeCount = useDocumentChanges(docId).data?.length || undefined
  const comments = useAllDocumentComments(docId, {
    enabled: isDocument,
  })
  const commentCount = comments.data?.length || undefined
  const citations = useSortedCitations(docId, {
    enabled: isDocument,
  })
  const citationCount = citations.docCitations.length || undefined
  const childrenActivity = useChildrenActivity(docId, {
    enabled: isDocument,
  })
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
  header,
  title,
  ...props
}: {
  children?: React.ReactNode
  footer?: React.ReactNode
  header?: React.ReactNode
  title?: string
}) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden" {...props}>
      {header ? <div className="p-3">{header}</div> : null}
      <ScrollArea>
        <div className={cn('flex flex-col gap-2 p-3', header && 'pt-0')}>
          {children}
        </div>
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
