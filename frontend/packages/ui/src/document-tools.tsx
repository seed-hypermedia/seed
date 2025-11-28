import {useIsomorphicLayoutEffect} from '@shm/shared/utils/use-isomorphic-layout-effect'
import {Folder, MessageSquare, Users} from 'lucide-react'
import {useRef, useState} from 'react'
import {Button, ButtonProps} from './button'
import {HistoryIcon} from './icons'
import {Tooltip} from './tooltip'

export function DocumentTools({
  activePanel,
  onCommentsClick,
  onFeedClick,
  onDirectoryClick,
  onCollabsClick,
  commentsCount = 0,
  collabsCount = 0,
  directoryCount = 0,
}: {
  activePanel?: 'activity' | 'discussions' | 'collaborators' | 'directory'
  onCommentsClick?: () => void
  onFeedClick?: () => void
  onDirectoryClick?: () => void
  onCollabsClick?: () => void
  commentsCount?: number
  collabsCount?: number
  directoryCount?: number
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

    const resizeObserver = new ResizeObserver(updateLabelVisibility)
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
    }
  }, [onFeedClick, onCommentsClick, onCollabsClick, onDirectoryClick])

  return (
    <div className="border-border border-b">
      <div
        ref={containerRef}
        className="mx-auto flex max-w-3xl items-center justify-center gap-2 p-1 md:gap-4 md:p-2"
      >
        {/* Hidden measurement container with labels always visible */}
        <div
          ref={measureRef}
          className="pointer-events-none absolute flex items-center justify-center gap-2 opacity-0 md:gap-4"
          aria-hidden="true"
        >
          {onFeedClick ? (
            <ButtonTool
              active={activePanel == 'activity'}
              onClick={onFeedClick}
              label="Activity"
              tooltip="Open Document Activity"
              icon={() => <HistoryIcon />}
              showLabel
            />
          ) : null}
          {onCommentsClick ? (
            <ButtonTool
              active={activePanel == 'discussions'}
              onClick={onCommentsClick}
              label="Comments"
              tooltip="Open Document Comments"
              count={commentsCount}
              icon={MessageSquare}
              showLabel
            />
          ) : null}
          {onCollabsClick ? (
            <ButtonTool
              active={activePanel == 'collaborators'}
              onClick={onCollabsClick}
              count={collabsCount}
              label="Collaborators"
              tooltip="Open Document Collaborators"
              icon={Users}
              showLabel
            />
          ) : null}
          {onDirectoryClick ? (
            <ButtonTool
              active={activePanel == 'directory'}
              onClick={onDirectoryClick}
              count={directoryCount}
              label="Children Documents"
              tooltip="Open Children Documents"
              icon={Folder}
              showLabel
            />
          ) : null}
        </div>

        {/* Actual visible buttons */}
        {onFeedClick ? (
          <ButtonTool
            active={activePanel == 'activity'}
            onClick={onFeedClick}
            label="Activity"
            tooltip="Open Document Activity"
            icon={() => <HistoryIcon />}
            showLabel={showLabels}
          />
        ) : null}
        {onCommentsClick ? (
          <ButtonTool
            active={activePanel == 'discussions'}
            onClick={onCommentsClick}
            label="Comments"
            tooltip="Open Document Comments"
            count={commentsCount}
            icon={MessageSquare}
            showLabel={showLabels}
          />
        ) : null}
        {onCollabsClick ? (
          <ButtonTool
            active={activePanel == 'collaborators'}
            onClick={onCollabsClick}
            count={collabsCount}
            label="Collaborators"
            tooltip="Open Document Collaborators"
            icon={Users}
            showLabel={showLabels}
          />
        ) : null}
        {onDirectoryClick ? (
          <ButtonTool
            active={activePanel == 'directory'}
            onClick={onDirectoryClick}
            count={directoryCount}
            label="Children Documents"
            tooltip="Open Children Documents"
            icon={Folder}
            showLabel={showLabels}
          />
        ) : null}
      </div>
    </div>
  )
}

function ButtonTool({
  onClick,
  label,
  tooltip,
  count,
  icon: Icon,
  active = false,
  showLabel = true,
}: ButtonProps & {
  label?: string
  count?: number
  icon: any
  tooltip?: string
  active?: boolean
  showLabel?: boolean
}) {
  let btn = (
    <Button
      onClick={onClick}
      className="flex-1"
      variant={active ? 'accent' : 'ghost'}
    >
      <Icon className="size-4" />
      {count ? <span className="text-sm">{count}</span> : null}
      {label && showLabel ? (
        <span className="hidden truncate text-sm md:block">{label}</span>
      ) : null}
    </Button>
  )
  return tooltip ? <Tooltip content={tooltip}>{btn}</Tooltip> : btn
}
