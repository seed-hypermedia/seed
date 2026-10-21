import {PanelSelectionOptions} from '@shm/shared'
import {useIsomorphicLayoutEffect} from '@shm/shared/utils/use-isomorphic-layout-effect'
import {Maximize, X} from 'lucide-react'
import {useRef, useState} from 'react'
import {Group, Panel} from 'react-resizable-panels'
import {AnimatedPanel, PanelSeparator, useSavedPanelLayout} from './resizable-panels'
import {Button} from './button'
import {FeedFilters} from './feed-filters'
import {Text} from './text'
import {cn} from './utils'

const DEFAULT_PANEL_PX = 440
const MAX_OPEN_PERCENT = 30
const MAX_PANEL_PERCENT = 50
const MIN_PANEL_PERCENT = 20
const MIN_PANEL_PX = 250

/**
 * The panel's minimum size as a percentage of its container. Keeps the panel at least
 * MIN_PANEL_PX wide, without exceeding the largest size a panel may take.
 */
export function getPanelMinPercent(containerWidth: number) {
  if (!containerWidth) return MIN_PANEL_PERCENT
  return Math.min(MAX_PANEL_PERCENT, Math.max(MIN_PANEL_PERCENT, (MIN_PANEL_PX / containerWidth) * 100))
}

export interface PanelLayoutProps {
  children: React.ReactNode
  panelContent: React.ReactNode | null
  panelKey: PanelSelectionOptions | null
  onPanelClose: () => void
  /** Total comments for the document shown in the comments panel. */
  commentsCount?: number
  /** Open the current comments selection in the full-page view. */
  onCommentsExpand?: () => void
  /** True when the activity panel is being used as the shared versions panel. */
  isVersionsPanel?: boolean
  /** True when the activity panel is scoped to one block's citations. */
  isCitationsPanel?: boolean
  /** For activity panel: current filter state */
  filterEventType?: string[]
  /** For activity panel: filter change handler */
  onFilterChange?: (filter: {filterEventType?: string[]}) => void
  /** Storage for panel width persistence (desktop uses nav state, web uses localStorage) */
  widthStorage?: {
    getItem: (name: string) => string
    setItem: (name: string, value: string) => void
  }
  /** Current panel width percentage (for controlled mode) */
  panelWidth?: number
  /** Callback when panel width changes */
  onPanelWidthChange?: (width: number) => void
  /** Replaces the default header, for panels with their own controls. */
  header?: React.ReactNode
}

function getPanelTitle(panelKey: PanelSelectionOptions | null): string {
  switch (panelKey) {
    case 'activity':
      return 'Document Activity'
    case 'comments':
      return 'Comments'
    case 'directory':
      return 'Sub documents'
    case 'collaborators':
      return 'Collaborators'
    case 'options':
      return 'Draft Options'
    case 'metadata':
      return 'Attributes'
    case 'feed':
      return 'Activity'
    default:
      return ''
  }
}

/** Resolves the title and filter visibility for a document side panel. */
export function getPanelHeaderState(
  panelKey: PanelSelectionOptions | null,
  isVersionsPanel: boolean,
  isCitationsPanel: boolean,
): {title: string; showActivityFilters: boolean} {
  return {
    title: isVersionsPanel ? 'Versions history' : isCitationsPanel ? 'Citations' : getPanelTitle(panelKey),
    showActivityFilters: panelKey === 'activity' && !isVersionsPanel && !isCitationsPanel,
  }
}

export function PanelLayout({
  children,
  panelContent,
  panelKey,
  onPanelClose,
  commentsCount,
  onCommentsExpand,
  isVersionsPanel = false,
  isCitationsPanel = false,
  filterEventType,
  onFilterChange,
  widthStorage,
  panelWidth,
  onPanelWidthChange,
  header,
}: PanelLayoutProps) {
  const saved = useSavedPanelLayout('resource-panel', ['main', 'accessory'], widthStorage)
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const minPanelPercent = getPanelMinPercent(containerWidth)

  // The minimum is a fixed pixel width, so its percentage follows the container as the window resizes.
  useIsomorphicLayoutEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry?.contentRect.width ?? 0))
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const {title, showActivityFilters} = getPanelHeaderState(panelKey, isVersionsPanel, isCitationsPanel)

  return (
    <div ref={containerRef} className="flex h-full flex-1">
      <Group
        orientation="horizontal"
        className="flex-1"
        onLayoutChanged={(layout, meta) => {
          saved.onLayoutChanged(layout, meta)
          if (!meta.isUserInteraction) return
          const width = (meta.requestedLayout ?? layout).accessory
          if (width && width > 0) onPanelWidthChange?.(width)
          if (layout.accessory === 0 && panelKey !== null) onPanelClose()
        }}
      >
        <Panel id="main" minSize={`${100 - MAX_PANEL_PERCENT}%`}>
          <div className="relative h-full rounded-lg">{children}</div>
        </Panel>

        <PanelSeparator open={panelKey !== null} onCollapse={onPanelClose} />
        <AnimatedPanel
          id="accessory"
          open={panelKey !== null}
          maxSize={`${MAX_PANEL_PERCENT}%`}
          minSize={`${minPanelPercent}%`}
          defaultSize={`${Math.max(
            panelWidth ||
              saved.expanded?.accessory ||
              Math.min(MAX_OPEN_PERCENT, containerWidth ? (DEFAULT_PANEL_PX / containerWidth) * 100 : MAX_OPEN_PERCENT),
            minPanelPercent,
          )}%`}
          className="border-l"
        >
          <div className="h-full rounded-lg">
            <div className={cn('dark:bg-background flex h-full flex-col bg-white')}>
              <div
                className={cn(
                  'border-border shrink-0 border-b px-5',
                  panelKey === 'comments' ? 'bg-card box-border flex h-12 flex-col justify-center' : 'py-3',
                )}
              >
                {header ?? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <Text weight="semibold" size="lg" className="flex flex-1 items-center gap-2">
                        {title}
                        {panelKey === 'comments' && commentsCount !== undefined && (
                          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium">
                            {commentsCount}
                          </span>
                        )}
                      </Text>
                      {panelKey === 'comments' && onCommentsExpand && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Expand comments"
                          title="Expand comments"
                          onClick={onCommentsExpand}
                        >
                          <Maximize className="size-4" />
                        </Button>
                      )}
                      <Button size="icon" aria-label="Close panel" onClick={onPanelClose}>
                        <X className="size-4" />
                      </Button>
                    </div>
                    {showActivityFilters && onFilterChange && (
                      <FeedFilters filterEventType={filterEventType} onFilterChange={onFilterChange} />
                    )}
                  </>
                )}
              </div>
              <div className={cn('flex-1 overflow-hidden', panelKey === 'comments' && 'bg-background')}>
                {panelContent}
              </div>
            </div>
          </div>
        </AnimatedPanel>
      </Group>
    </div>
  )
}
