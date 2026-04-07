import {HMExistingDraft, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {
  activityFilterToSlug,
  activitySlugToFilter,
  createInspectNavRoute,
  DocumentPanelRoute,
  InspectRoute,
  NavRoute,
} from '@shm/shared'
import type {InspectTab} from '@shm/shared/routes'
import {useIsomorphicLayoutEffect} from '@shm/shared/utils/use-isomorphic-layout-effect'
import {
  FileText,
  Folder,
  History,
  LucideIcon,
  MessageSquare,
  MessagesSquare,
  Newspaper,
  Quote,
  Shield,
  Users,
} from 'lucide-react'
import {useRef, useState} from 'react'
import {PageTab} from './page-tabs'
import {cn} from './utils'

export function DocumentTools({
  id,
  activeTab,
  commentsCount = 0,
  citationsCount = 0,
  collabsCount = 0,
  rightActions,
  existingDraft,
  currentPanel,
  mode = 'document',
  inspectRoute,
  inspectTabs,
  layoutProps,
}: {
  id: UnpackedHypermediaId
  activeTab?: 'draft' | 'content' | 'comments' | 'collaborators' | 'citations'
  commentsCount?: number
  citationsCount?: number
  collabsCount?: number
  rightActions?: React.ReactNode
  existingDraft?: HMExistingDraft | false
  /** Current panel route — tabs preserve this when navigating */
  currentPanel?: DocumentPanelRoute | null
  mode?: 'document' | 'inspect'
  inspectRoute?: InspectRoute | null
  inspectTabs?: {
    tab: InspectTab
    label: string
    tooltip: string
    icon: LucideIcon
    count?: number
  }[]
  /** When provided, renders tabs in the same three-segment layout as main content */
  layoutProps?: {
    wrapperProps: React.HTMLAttributes<HTMLDivElement>
    sidebarProps: React.HTMLAttributes<HTMLDivElement>
    mainContentProps: React.HTMLAttributes<HTMLDivElement>
    showSidebars: boolean
  }
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const [showLabels, setShowLabels] = useState(true)

  useIsomorphicLayoutEffect(() => {
    if (!containerRef.current || !measureRef.current) return

    const updateLabelVisibility = () => {
      if (!containerRef.current || !measureRef.current) return

      const containerWidth = containerRef.current.offsetWidth
      const measuredWidth = measureRef.current.offsetWidth

      // Add some padding for safety
      setShowLabels(measuredWidth + 20 <= containerWidth)
    }

    updateLabelVisibility()

    const resizeObserver = new ResizeObserver(() => {
      updateLabelVisibility()
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
    }
  }, [activeTab, inspectRoute?.inspectTab, mode])

  // Always carry over the current panel so it stays open across tab switches.
  // Cast needed because each route type has its own panel union (excluding itself)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const panelFor = (): any => currentPanel || undefined

  // Strip blockRef/blockRange for non-content tabs
  const idWithoutBlock = {...id, blockRef: null, blockRange: null}

  const documentRoute: NavRoute = {
    key: 'document',
    id,
    panel: panelFor(),
  }
  const inspectActivityPanelParam =
    inspectRoute?.targetView === 'activity'
      ? (() => {
          const slug = activityFilterToSlug(inspectRoute.targetActivityFilter)
          return slug ? `activity/${slug}` : null
        })()
      : null
  const buttons: {
    label: string
    tooltip: string
    icon: LucideIcon
    count?: number
    active: boolean
    route: NavRoute
    bg?: string
  }[] =
    mode === 'inspect' && inspectRoute
      ? (
          inspectTabs || [
            {
              tab: 'document' as const,
              label: 'Document',
              tooltip: 'Inspect Document State',
              icon: FileText,
            },
            {
              tab: 'changes' as const,
              label: 'Changes',
              tooltip: 'Inspect Document Changes',
              icon: History,
            },
            {
              tab: 'comments' as const,
              label: 'Comments',
              tooltip: 'Inspect Comments',
              icon: MessageSquare,
            },
            {
              tab: 'citations' as const,
              label: 'Citations',
              tooltip: 'Inspect Citations',
              icon: Quote,
            },
            {
              tab: 'children' as const,
              label: 'Children',
              tooltip: 'Inspect Child Documents',
              icon: Folder,
            },
            {
              tab: 'authored-comments' as const,
              label: 'Authored',
              tooltip: 'Inspect Authored Comments',
              icon: MessagesSquare,
            },
            {
              tab: 'contacts' as const,
              label: 'Contacts',
              tooltip: 'Inspect Site Contacts',
              icon: Users,
            },
            {
              tab: 'capabilities' as const,
              label: 'Capabilities',
              tooltip: 'Inspect Capabilities',
              icon: Shield,
            },
          ]
        ).map((tab) => ({
          label: tab.label,
          tooltip: tab.tooltip,
          icon: tab.icon,
          count: tab.count,
          active: (inspectRoute.inspectTab || 'document') === tab.tab,
          route: createInspectNavRoute(
            idWithoutBlock,
            inspectRoute.targetView,
            inspectActivityPanelParam,
            inspectRoute.targetOpenComment,
            inspectRoute.targetAccountUid,
            tab.tab === 'document' ? null : tab.tab,
          ),
        }))
      : [
          {
            label: 'Content',
            tooltip: existingDraft ? 'Resume Editing' : 'Open Content',
            icon: Newspaper,
            active: activeTab == 'draft' || activeTab == 'content',
            route: existingDraft
              ? activeTab === 'draft'
                ? documentRoute
                : {
                    key: 'draft',
                    id: existingDraft.id,
                    editPath: id.path || [],
                    editUid: id.uid,
                    panel: panelFor(),
                  }
              : documentRoute,
          },
          {
            label: 'People',
            tooltip: 'Open Document Collaborators',
            icon: Users,
            active: activeTab == 'collaborators',
            count: collabsCount,
            route: {key: 'collaborators', id: idWithoutBlock, panel: panelFor()},
          },
          {
            label: 'Comments',
            tooltip: 'Open Document Comments',
            icon: MessageSquare,
            active: activeTab == 'comments',
            count: commentsCount,
            route: {key: 'comments', id: idWithoutBlock, panel: panelFor()},
          },
          {
            label: 'Citations',
            tooltip: 'Open Document Citations',
            icon: Quote,
            active: activeTab == 'citations',
            count: citationsCount,
            route: {
              key: 'activity',
              id: idWithoutBlock,
              filterEventType: activitySlugToFilter('citations'),
              panel: panelFor(),
            },
          },
        ]
  const tabButtons = (
    <>
      {/* Hidden measurement container with labels always visible */}
      <div
        ref={measureRef}
        className="pointer-events-none absolute flex items-center gap-2 opacity-0 md:gap-4"
        aria-hidden="true"
      >
        {buttons.map((button) => (
          <PageTab
            key={button.label}
            active={button.active}
            route={button.route}
            label={button.label}
            tooltip={button.tooltip}
            icon={button.icon}
            count={button.count}
            bg={button.bg}
            showLabel
          />
        ))}
      </div>
      {buttons.map((button) => (
        <PageTab
          key={button.label}
          active={button.active}
          route={button.route}
          label={button.label}
          tooltip={button.tooltip}
          icon={button.icon}
          count={button.count}
          bg={button.bg}
          showLabel={showLabels}
        />
      ))}
    </>
  )

  if (layoutProps) {
    const {wrapperProps, sidebarProps, mainContentProps, showSidebars} = layoutProps

    if (showSidebars) {
      return (
        <div className="flex w-full shrink-0">
          <div
            {...wrapperProps}
            className={cn(wrapperProps.className, 'flex flex-1 items-center')}
            style={wrapperProps.style}
          >
            <div {...sidebarProps} className={cn(sidebarProps.className, '!h-auto !p-0')} />
            <div
              {...mainContentProps}
              ref={containerRef}
              className={cn(mainContentProps.className, 'flex items-center gap-2 p-1 md:gap-4 md:p-2')}
            >
              {tabButtons}
            </div>
            <div {...sidebarProps} className={cn(sidebarProps.className, 'flex !h-auto items-center !p-0')}>
              {rightActions ? <div className="flex shrink-0 items-center">{rightActions}</div> : null}
            </div>
          </div>
        </div>
      )
    }

    // No sidebars: center with mx-auto, no flex-1 (matching header pattern)
    return (
      <div className="flex w-full shrink-0">
        <div style={wrapperProps.style} className="mx-auto flex w-full items-center justify-between">
          <div
            {...mainContentProps}
            ref={containerRef}
            className={cn(mainContentProps.className, 'flex items-center gap-2 p-1 md:gap-4 md:p-2')}
          >
            {tabButtons}
          </div>
          {rightActions && <div className="flex shrink-0 items-center">{rightActions}</div>}
        </div>
      </div>
    )
  }

  return (
    <div className="flex w-full shrink-0">
      <div ref={containerRef} className="flex flex-1 items-center gap-2 p-1 md:gap-4 md:p-2">
        {tabButtons}
      </div>
      {rightActions ? <div className="flex shrink-0 items-center px-4">{rightActions}</div> : null}
    </div>
  )
}
