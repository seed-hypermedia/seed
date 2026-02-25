import {DocumentPanelRoute, NavRoute, useRouteLink} from '@shm/shared'
import {HMExistingDraft, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useIsomorphicLayoutEffect} from '@shm/shared/utils/use-isomorphic-layout-effect'
import {MessageSquare, Newspaper, Users} from 'lucide-react'
import {useRef, useState} from 'react'
import {Button, ButtonProps} from './button'
import {IconComponent} from './icons'
import {Tooltip} from './tooltip'
import {cn} from './utils'

export function DocumentTools({
  id,
  activeTab,
  commentsCount = 0,
  collabsCount = 0,
  rightActions,
  existingDraft,
  currentPanel,
  layoutProps,
}: {
  id: UnpackedHypermediaId
  activeTab?: 'draft' | 'content' | 'comments' | 'collaborators'
  commentsCount?: number
  collabsCount?: number
  rightActions?: React.ReactNode
  existingDraft?: HMExistingDraft | false
  /** Current panel route — tabs preserve this when navigating */
  currentPanel?: DocumentPanelRoute | null
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
  const rightActionsRef = useRef<HTMLDivElement>(null)
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
  }, [activeTab])

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
  const buttons: {
    label: string
    tooltip: string
    icon: IconComponent
    count?: number
    active: boolean
    route: NavRoute
    bg?: string
  }[] = [
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
      // bg: existingDraft ? 'bg-yellow-200' : undefined,
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
          <ToolLink
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
        <ToolLink
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
              {rightActions ? (
                <div ref={rightActionsRef} className="flex shrink-0 items-center">
                  {rightActions}
                </div>
              ) : null}
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
          {rightActions && (
            <div ref={rightActionsRef} className="flex shrink-0 items-center">
              {rightActions}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex w-full shrink-0">
      <div ref={containerRef} className="flex flex-1 items-center gap-2 p-1 md:gap-4 md:p-2">
        {tabButtons}
      </div>
      {rightActions ? (
        <div ref={rightActionsRef} className="flex shrink-0 items-center px-4">
          {rightActions}
        </div>
      ) : null}
    </div>
  )
}

function ToolLink({
  route,
  label,
  tooltip,
  count,
  icon: Icon,
  active = false,
  showLabel = true,
  bg,
}: ButtonProps & {
  route: NavRoute
  label?: string
  count?: number
  icon: any
  tooltip?: string
  active?: boolean
  showLabel?: boolean
  bg?: string
}) {
  const linkProps = useRouteLink(route)
  let btn = (
    <Button
      className={cn('plausible-event-name=Open+Document+Comments flex-1 rounded-full', bg)}
      asChild
      variant={active ? 'accent' : 'ghost'}
    >
      <a {...linkProps}>
        <Icon className="size-4" />
        {label && showLabel ? <span className="hidden truncate text-sm md:block">{label}</span> : null}
        {count ? <span className="text-sm">{count}</span> : null}
      </a>
    </Button>
  )
  return <Tooltip content={active ? '' : tooltip || ''}>{btn}</Tooltip>
}
