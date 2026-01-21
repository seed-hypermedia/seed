import {NavRoute, useRouteLink} from '@shm/shared'
import {IS_DESKTOP} from '@shm/shared/constants'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useIsomorphicLayoutEffect} from '@shm/shared/utils/use-isomorphic-layout-effect'
import {Folder, MessageSquare, Newspaper, Users} from 'lucide-react'
import {useRef, useState} from 'react'
import {Button, ButtonProps} from './button'
import {HistoryIcon, IconComponent} from './icons'
import {Tooltip} from './tooltip'

export function DocumentTools({
  id,
  activeTab,
  commentsCount = 0,
  collabsCount = 0,
  directoryCount = 0,
  rightActions,
}: {
  id: UnpackedHypermediaId
  /** Which tab is currently active in the main content area */
  activeTab?:
    | 'content'
    | 'activity'
    | 'discussions'
    | 'collaborators'
    | 'directory'
  commentsCount?: number
  collabsCount?: number
  directoryCount?: number
  rightActions?: React.ReactNode
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const rightActionsRef = useRef<HTMLDivElement>(null)
  const [showLabels, setShowLabels] = useState(true)
  const [rightActionsWidth, setRightActionsWidth] = useState(0)

  useIsomorphicLayoutEffect(() => {
    if (!containerRef.current || !measureRef.current) return

    const updateLabelVisibility = () => {
      if (!containerRef.current || !measureRef.current) return

      const containerWidth = containerRef.current.offsetWidth
      const measuredWidth = measureRef.current.offsetWidth

      // Add some padding for safety
      setShowLabels(measuredWidth + 20 <= containerWidth)
    }

    const updateRightActionsWidth = () => {
      if (rightActionsRef.current) {
        setRightActionsWidth(rightActionsRef.current.offsetWidth)
      }
    }

    updateLabelVisibility()
    updateRightActionsWidth()

    const resizeObserver = new ResizeObserver(() => {
      updateLabelVisibility()
      updateRightActionsWidth()
    })
    resizeObserver.observe(containerRef.current)
    if (rightActionsRef.current) {
      resizeObserver.observe(rightActionsRef.current)
    }

    return () => {
      resizeObserver.disconnect()
    }
  }, [activeTab])

  const buttons: {
    label: string
    tooltip: string
    icon: IconComponent
    count?: number
    active: boolean
    route: NavRoute
  }[] = [
    {
      label: 'Content',
      tooltip: 'Open Content',
      icon: Newspaper,
      active: activeTab == 'content',
      route: {key: 'document', id: id},
    },
    {
      label: 'Activity',
      tooltip: 'Open Document Activity',
      icon: HistoryIcon,
      active: activeTab == 'activity',
      route: {key: 'activity', id: id},
    },
    {
      label: 'Comments',
      tooltip: 'Open Document Comments',
      icon: MessageSquare,
      active: activeTab == 'discussions',
      count: commentsCount,
      route: {key: 'discussions', id: id},
    },
    {
      label: 'Collaborators',
      tooltip: 'Open Document Collaborators',
      icon: Users,
      active: activeTab == 'collaborators',
      count: collabsCount,
      route: {key: 'collaborators', id: id},
    },
    {
      label: 'Children Documents',
      tooltip: 'Open Children Documents',
      icon: Folder,
      active: activeTab == 'directory',
      count: directoryCount,
      route: {key: 'directory', id: id},
    },
  ]
  return (
    <div className="flex w-full shrink-0">
      {/* Left spacer to balance the right actions */}
      <div style={{width: rightActionsWidth}} className="shrink-0" />
      <div
        ref={containerRef}
        className="flex flex-1 items-center justify-center gap-2 p-1 md:gap-4 md:p-2"
      >
        {/* Hidden measurement container with labels always visible */}
        <div
          ref={measureRef}
          className="pointer-events-none absolute flex items-center justify-center gap-2 opacity-0 md:gap-4"
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
            showLabel={showLabels}
          />
        ))}
      </div>
      <div
        ref={rightActionsRef}
        className="flex shrink-0 items-center gap-2 p-1 md:gap-4 md:p-2"
      >
        {rightActions}
      </div>
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
}: ButtonProps & {
  route: NavRoute
  label?: string
  count?: number
  icon: any
  tooltip?: string
  active?: boolean
  showLabel?: boolean
}) {
  const linkProps = useRouteLink(route)
  let btn = (
    <Button
      className={`flex-1 rounded-full ${
        IS_DESKTOP ? '' : 'plausible-event-name=Open+Document+Comments'
      }`}
      asChild
      variant={active ? 'accent' : 'ghost'}
    >
      <a {...linkProps}>
        <Icon className="size-4" />
        {count ? <span className="text-sm">{count}</span> : null}
        {label && showLabel ? (
          <span className="hidden truncate text-sm md:block">{label}</span>
        ) : null}
      </a>
    </Button>
  )
  return tooltip ? <Tooltip content={tooltip}>{btn}</Tooltip> : btn
}
