import {HMListDocumentCollaboratorsOutput, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {
  hmId,
  activityFilterToSlug,
  activitySlugToFilter,
  createInspectNavRoute,
  DocumentPanelRoute,
  InspectRoute,
  NavRoute,
} from '@shm/shared'
import type {InspectTab} from '@shm/shared/routes'
import type {DocumentRoute} from '@shm/shared/routes'
import {useIsomorphicLayoutEffect} from '@shm/shared/utils/use-isomorphic-layout-effect'
import {
  MessageCircle,
  FileCode2,
  FileText,
  Folder,
  GitGraph,
  History,
  Info,
  LucideIcon,
  MessagesSquare,
  Newspaper,
  Quote,
  Shield,
  Users,
  Bot,
  Wrench,
  Settings,
  Zap,
  Brain,
  ScrollText,
} from 'lucide-react'
import {cloneElement, isValidElement, useRef, useState} from 'react'
import {PageTab} from './page-tabs'
import {cn} from './utils'
import {HMIcon} from './hm-icon'
import {getCommentAudienceAccountUids} from './members-facepile'

/** Opens a document tool in a panel while preserving the current document or draft. */
export function getDocumentToolRoute(
  currentRoute: NavRoute | undefined,
  id: UnpackedHypermediaId,
  panel: DocumentPanelRoute,
): NavRoute {
  if (currentRoute?.key === 'document' || currentRoute?.key === 'draft' || currentRoute?.key === 'feed') {
    return {...currentRoute, panel}
  }
  if (currentRoute?.key === panel.key) {
    const {
      panel: _panel,
      width: _width,
      ...selection
    } = currentRoute as DocumentPanelRoute & {width?: number; panel?: DocumentPanelRoute | null}
    panel = {...selection, ...panel}
  }
  return {
    key: 'document',
    id:
      currentRoute && 'id' in currentRoute && typeof currentRoute.id !== 'string' && currentRoute.id
        ? currentRoute.id
        : {...id, version: null, latest: true},
    panel,
  }
}

/** Document tools open right panels; inspector tabs keep their own navigation. */
export function DocumentTools({
  id,
  activeTab,
  commentsCount = 0,
  citationsCount = 0,
  collabsCount = 0,
  collaborators,
  metadataCount = 0,
  schemaCid = null,
  activeTabAction,
  currentRoute,
  currentPanel,
  mode = 'document',
  inspectRoute,
  inspectTabs,
  layoutProps,
  hasAgent,
  agentHome,
  activeAgentView,
}: {
  id: UnpackedHypermediaId
  hasAgent?: boolean
  /** Agent resources display their identity home instead of mount content. */
  agentHome?: boolean
  activeAgentView?: DocumentRoute['agentView']
  activeTab?: 'draft' | 'content' | 'comments' | 'collaborators' | 'citations' | 'metadata' | 'schema'
  commentsCount?: number
  citationsCount?: number
  collabsCount?: number
  /** Existing People-list data for the avatar preview. */
  collaborators?: HMListDocumentCollaboratorsOutput | null
  /** Number of custom (non-built-in) metadata fields shown on the always-visible Attributes tab. */
  metadataCount?: number
  /** The schema CID the document defines (`schemaDefinition`); carried on the `schema` route. */
  schemaCid?: string | null
  /** Rendered immediately to the right of the active tab pill. When no tab is active, rendered as last sibling. */
  activeTabAction?: React.ReactNode
  /** Current page route, retained when opening a panel from a document or draft. */
  currentRoute?: NavRoute
  /** Current panel route, used for active state and existing thread selection. */
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
  const peopleAvatars = collaborators ? getCommentAudienceAccountUids(collaborators, !id.path?.length).slice(0, 3) : []
  const peoplePreview = peopleAvatars.length ? (
    <span className="flex shrink-0 -space-x-2" aria-hidden="true">
      {peopleAvatars.map((uid, index) => (
        <span key={`${uid}-${index}`} className="ring-card rounded-full ring-2" style={{zIndex: 3 - index}}>
          <HMIcon
            id={hmId(uid)}
            name={collaborators?.accounts[uid]?.metadata?.name}
            icon={collaborators?.accounts[uid]?.metadata?.icon}
            size={20}
          />
        </span>
      ))}
    </span>
  ) : undefined
  const containerRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const [showLabels, setShowLabels] = useState(true)

  useIsomorphicLayoutEffect(() => {
    if (!containerRef.current || !measureRef.current) return

    const updateLabelVisibility = () => {
      if (!containerRef.current || !measureRef.current) return

      const container = containerRef.current
      const style = getComputedStyle(container)
      const availableWidth = container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      setShowLabels(measureRef.current.offsetWidth <= availableWidth)
    }

    updateLabelVisibility()

    const resizeObserver = new ResizeObserver(() => {
      updateLabelVisibility()
    })
    resizeObserver.observe(containerRef.current)
    resizeObserver.observe(measureRef.current)

    return () => {
      resizeObserver.disconnect()
    }
  }, [activeTab, inspectRoute?.inspectTab, mode])

  const idWithoutBlock = {...id, blockRef: null, blockRange: null}
  const openPanel = (panel: DocumentPanelRoute) => getDocumentToolRoute(currentRoute, id, panel)
  const selectedTab = currentPanel
    ? currentPanel.key === 'activity' && activityFilterToSlug(currentPanel.filterEventType) === 'citations'
      ? 'citations'
      : currentPanel.key
    : activeTab
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
    showZeroCount?: boolean
    active: boolean
    route: NavRoute
    bg?: string
    leading?: React.ReactNode
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
              tab: 'graph' as const,
              label: 'Graph',
              tooltip: 'Inspect Document Version Graph',
              icon: GitGraph,
            },
            {
              tab: 'comments' as const,
              label: 'Comments',
              tooltip: 'Inspect Comments',
              icon: MessagesSquare,
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
              tooltip: 'Inspect Space Contacts',
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
            label: 'Comments',
            tooltip: 'Open Document Comments',
            icon: MessageCircle,
            active: selectedTab === 'comments',
            count: commentsCount,
            route: openPanel(currentPanel?.key === 'comments' ? currentPanel : {key: 'comments', id: idWithoutBlock}),
          },
          {
            label: `${collabsCount} ${collabsCount === 1 ? 'person' : 'people'}`,
            tooltip: 'Open Document Collaborators',
            icon: Users,
            active: selectedTab === 'collaborators',
            leading: peoplePreview,
            route: openPanel({key: 'collaborators', id: idWithoutBlock}),
          },
          {
            label: 'Connections',
            tooltip: 'Open Document Connections',
            icon: GitGraph,
            active: selectedTab === 'citations',
            count: citationsCount,
            route: openPanel({
              key: 'activity',
              id: idWithoutBlock,
              filterEventType: activitySlugToFilter('citations'),
            }),
          },
          {
            label: 'Attributes',
            tooltip: 'Open Document Attributes',
            icon: Info,
            active: selectedTab === 'metadata',
            count: metadataCount,
            showZeroCount: true,
            route: openPanel({key: 'metadata', id: idWithoutBlock}),
          },
          // The schema a document defines renders above its body (DocumentSchemaSection), so the
          // tab is not offered; it only shows while the `schema` route itself is open, so that
          // route keeps a tab to sit on. The route carries the CID too, so CID-addressed
          // affordances (the dev Inspect) work there.
          ...(activeTab === 'schema'
            ? [
                {
                  label: 'Schema',
                  tooltip: 'Open the schema this document defines',
                  icon: FileCode2,
                  active: activeTab === 'schema',
                  route: {key: 'schema', id: idWithoutBlock, cid: schemaCid ?? undefined} as NavRoute,
                },
              ]
            : []),
        ]
  if ((hasAgent || agentHome) && mode === 'document') {
    // Agent views replace the document body, so the agent tab bar needs a tab back to it.
    // Link to the latest content at the base path, never the resolved version.
    const documentRoute: NavRoute = {
      key: 'document',
      id: {...idWithoutBlock, version: null, latest: true},
      panel: currentPanel || undefined,
    }
    const agentTabs: {view: NonNullable<DocumentRoute['agentView']>; label: string; icon: LucideIcon}[] = hasAgent
      ? [
          {view: 'sessions', label: 'Sessions', icon: Bot},
          {view: 'tools', label: 'Tools', icon: Wrench},
          {view: 'triggers', label: 'Triggers', icon: Zap},
          {view: 'memory', label: 'Memory', icon: Brain},
          {view: 'prompt', label: 'Prompt', icon: ScrollText},
          {view: 'access', label: 'Agent access', icon: Shield},
          {view: 'settings', label: 'Settings', icon: Settings},
        ]
      : []
    buttons.unshift(
      {
        label: agentHome ? 'Home' : 'Content',
        tooltip: agentHome ? 'Open Agent Home' : 'Open Content',
        icon: Newspaper,
        active: !activeAgentView && (activeTab == 'draft' || activeTab == 'content'),
        route: documentRoute,
      },
      ...agentTabs.map(({view, label, icon}) => ({
        label,
        tooltip: `Open agent ${label.toLowerCase()}`,
        icon,
        active: activeAgentView === view || (view === 'sessions' && activeAgentView === 'session'),
        route: {...documentRoute, agentView: view},
      })),
    )
  }
  const hasActive = buttons.some((b) => b.active)
  const standaloneAction =
    !hasActive && activeTabAction
      ? isValidElement(activeTabAction)
        ? cloneElement(activeTabAction as React.ReactElement<{accent?: boolean}>, {accent: true})
        : activeTabAction
      : null
  const tabButtons = (
    <>
      {/* Hidden measurement container with labels always visible */}
      <div className="pointer-events-none invisible absolute h-0 w-0 overflow-hidden" aria-hidden="true">
        <div ref={measureRef} className={cn('flex w-max items-center gap-2', mode === 'inspect' && 'md:gap-4')}>
          {buttons.map((button) => (
            <PageTab
              key={button.label}
              active={button.active}
              route={button.route}
              label={button.label}
              tooltip={button.tooltip}
              icon={button.icon}
              count={button.count}
              showZeroCount={button.showZeroCount}
              bg={button.bg}
              showLabel
              appearance={mode === 'document' ? 'document-tool' : 'default'}
              leading={button.leading}
              moveToPanel={
                mode === 'document' &&
                button.active &&
                'panel' in button.route &&
                currentRoute?.key === button.route.panel?.key
              }
              trailingAction={button.active ? activeTabAction : undefined}
            />
          ))}
          {standaloneAction}
        </div>
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
          showZeroCount={button.showZeroCount}
          bg={button.bg}
          showLabel={hasAgent || showLabels}
          collapsedCount={
            mode === 'document' && 'panel' in button.route && button.route.panel?.key === 'collaborators'
              ? collabsCount
              : undefined
          }
          appearance={mode === 'document' ? 'document-tool' : 'default'}
          leading={button.leading}
          moveToPanel={
            mode === 'document' &&
            button.active &&
            'panel' in button.route &&
            currentRoute?.key === button.route.panel?.key
          }
          trailingAction={button.active ? activeTabAction : undefined}
        />
      ))}
      {standaloneAction}
    </>
  )

  if (hasAgent)
    return (
      <div ref={containerRef} className="flex min-w-0 items-center gap-2 overflow-x-auto p-1">
        {tabButtons}
      </div>
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
              className={cn(
                mainContentProps.className,
                'flex items-center gap-2 p-1 md:p-2',
                mode === 'document' ? 'flex-wrap' : 'md:gap-4',
              )}
            >
              {tabButtons}
            </div>
            <div {...sidebarProps} className={cn(sidebarProps.className, '!h-auto !p-0')} />
          </div>
        </div>
      )
    }

    // No sidebars: keep the tab row aligned with the centered document header.
    return (
      <div className="flex w-full shrink-0">
        <div style={wrapperProps.style} className="mx-auto flex w-full items-center justify-center">
          <div
            {...mainContentProps}
            ref={containerRef}
            className={cn(
              mainContentProps.className,
              'flex items-center gap-2 p-1 md:p-2',
              mode === 'document' ? 'flex-wrap' : 'md:gap-4',
            )}
          >
            {tabButtons}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex w-full shrink-0">
      <div
        ref={containerRef}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 p-1 md:p-2',
          mode === 'document' ? 'flex-wrap' : 'md:gap-4',
        )}
      >
        {tabButtons}
      </div>
    </div>
  )
}
