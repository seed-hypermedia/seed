import {useAllDocumentCapabilities} from '@/models/access-control'
import {useSortedCitations} from '@/models/citations'
import {useAllDocumentComments} from '@/models/comments'
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
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {panelContainerStyles} from '@shm/ui/container'
import {BlockQuote} from '@shm/ui/icons'
import {Text} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {cn} from '@shm/ui/utils'
import {
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

  const allDocumentCapabilities = useAllDocumentCapabilities(docId)
  const collaboratorCount =
    allDocumentCapabilities.data?.filter((c) => c.role !== 'agent')?.length ||
    undefined
  const activeChangeCount = useDocumentChanges(docId).data?.length || undefined
  const comments = useAllDocumentComments(docId)
  const commentCount = comments.data?.length || undefined
  const citations = useSortedCitations(docId)
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
        <div className="bg-background rounded-md py-2 dark:bg-black">
          {footer}
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
  return (
    <div className="flex items-center justify-center gap-1 p-2 px-3">
      {options.map((option) => {
        const isActive = accessoryKey === option.key
        const Icon = accessoryKey ? iconNames[option.key] : undefined
        return (
          <Tooltip content={option.label} key={option.key}>
            <span>
              <Button
                size="sm"
                variant={isActive ? 'brand-12' : 'ghost'}
                onClick={() => {
                  if (isActive) return
                  // if (isActive) onAccessorySelect(undefined)
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
    </div>
  )
}
